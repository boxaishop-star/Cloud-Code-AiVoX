import { classifyIntentLocally } from "./intentEngine.js";
import { validateProposedActions, sanitizeForResponse } from "./validation.js";
import { computeNextStep, computeReadiness, checkProfileReadyForDailyAssistant } from "./nextStepController.js";
import type { DataStore } from "./store.js";
import type { ExtractionProvider } from "./extraction/types.js";
import type { ToolAction, ToolActionResult } from "./schemas/toolAction.js";
import type { ProductCard } from "./schemas/productCard.js";
import type { NextStep } from "./nextStepController.js";
import type { AssistantStage } from "./schemas/businessFoundation.js";

// Раздел 13, ТЗ v3.0 — контракт processBusinessAssistantMessage(input): result.
// Независим от UI и от конкретного провайдера LLM (extraction/types.ts) — это и есть
// требование раздела 10 ("тестируется в изоляции").
export interface OrchestratorInput {
  userMessage: string;
  tenant_id: string;
  developerMode?: boolean;
}

export interface OrchestratorResult {
  assistantResponse: string;
  responseSource: "business_assistant_orchestrator";
  appliedActions: ToolActionResult[];
  rejectedActions: string[];
  nextStep?: NextStep;
  intent: string;
  confidence: number;
  /** Текущий этап ассистента — отражает состояние ПОСЛЕ обработки сообщения. */
  assistant_stage: AssistantStage;
}

export class BusinessAssistantOrchestrator {
  constructor(private store: DataStore, private extractor: ExtractionProvider) {}

  async process(input: OrchestratorInput): Promise<OrchestratorResult> {
    const local = classifyIntentLocally(input.userMessage);

    // small_talk / explain_product не идут в LLM — раздел 15.2 ТЗ (экономия на простых интентах).
    if (local.intent === "small_talk" || local.intent === "explain_product") {
      const foundation = await this.store.getFoundation(input.tenant_id);
      const stage: AssistantStage = (foundation as any)?.assistant_stage ?? "profile_setup";
      return {
        assistantResponse: this.renderSimpleIntentResponse(local.intent),
        responseSource: "business_assistant_orchestrator",
        appliedActions: [],
        rejectedActions: [],
        intent: local.intent,
        confidence: local.confidence,
        assistant_stage: stage,
      };
    }

    const [existingCards, foundation] = await Promise.all([
      this.store.getProductCards(input.tenant_id),
      this.store.getFoundation(input.tenant_id),
    ]);

    const currentStage: AssistantStage = (foundation as any)?.assistant_stage ?? "profile_setup";

    // Передаём missing_fields лучшей карточки в контекст провайдера —
    // модель точно знает, каких данных не хватает, и не повторяет одни вопросы.
    const bestExisting = existingCards.length > 0
      ? existingCards.reduce((b, c) => c.readiness_score > b.readiness_score ? c : b)
      : undefined;
    const { missing_fields: contextMissingFields } = bestExisting
      ? computeReadiness(bestExisting)
      : { missing_fields: [] };

    const extraction = await this.extractor.extract(input.userMessage, {
      tenant_id: input.tenant_id,
      businessFoundation: foundation ?? {},
      productCatalog: existingCards,
      assistant_stage: currentStage,
      missing_fields: contextMissingFields,
    });

    const existingCategories = [...new Set(existingCards.map((c) => c.category))];
    const { validActions, errors } = validateProposedActions(extraction.proposed_actions, existingCards, existingCategories);

    const appliedActions = await Promise.all(validActions.map((a) => this.store.applyAction(a)));

    // Expose toolLayer failures in rejectedActions so callers don't have to inspect appliedActions[].error.
    const toolLayerErrors = appliedActions
      .filter((r) => !r.applied && r.error)
      .map((r) => `${r.action.type}: ${r.error!}`);

    const freshCards = await this.store.getProductCards(input.tenant_id);
    const touchedServiceLine = validActions
      .find((a) => a.type === "upsert_product_card" || a.type === "update_product_card")
      ?.payload && (validActions.find((a) => a.type === "upsert_product_card" || a.type === "update_product_card")!.payload as any).service_line as string | undefined;
    const updatedCard = touchedServiceLine
      ? freshCards.find((c) => c.service_line === touchedServiceLine)
      : undefined;
    if (updatedCard) {
      const readiness = computeReadiness(updatedCard);
      Object.assign(updatedCard, readiness);
    }

    // Определяем создание vs обновление — влияет на формулировку ответа.
    const wasNewCard = touchedServiceLine
      ? !existingCards.some((c) => c.service_line === touchedServiceLine)
      : false;

    // Если нет явного updatedCard, пробуем подтянуть следующий шаг из лучшей существующей карточки
    // (так ответ остаётся контекстным вместо генерик-фолбека).
    const bestFreshCard = freshCards.length > 0
      ? freshCards.reduce((b, c) => c.readiness_score > b.readiness_score ? c : b)
      : undefined;
    const nextStep = updatedCard
      ? computeNextStep(updatedCard)
      : extraction.next_step ?? (bestFreshCard ? computeNextStep(bestFreshCard) : undefined);

    // ── Проверка перехода A→B (раздел 7.1.1 ТЗ v9.0) ─────────────────────────
    let finalStage: AssistantStage = currentStage;
    let stageTransitionMessage: string | undefined;

    if (currentStage === "profile_setup") {
      // Пересчитываем readiness для всех свежих карточек.
      const freshCardsWithReadiness = freshCards.map((c) => {
        const r = computeReadiness(c);
        return { ...c, ...r };
      });
      const freshFoundation = await this.store.getFoundation(input.tenant_id);
      if (checkProfileReadyForDailyAssistant(freshCardsWithReadiness, freshFoundation)) {
        await this.store.applyAction({
          type: "upsert_business_foundation",
          payload: { tenant_id: input.tenant_id, assistant_stage: "daily_assistant" },
        });
        finalStage = "daily_assistant";
        stageTransitionMessage =
          "Профиль заполнен — перехожу в режим Daily Assistant. " +
          "Теперь помогу отслеживать активность, лиды и отвечать на вопросы о текущем состоянии бизнеса.";
      }
    }

    const baseResponse = this.renderResponse(extraction.intent, updatedCard, appliedActions, nextStep, extraction.clarification_text, currentStage, wasNewCard);
    const assistantResponse = stageTransitionMessage
      ? `${stageTransitionMessage}\n\n${baseResponse}`
      : baseResponse;

    // Не дублируем nextStep когда clarification_text уже содержит полный ответ модели —
    // иначе UI рисует "Следующий вопрос" отдельным блоком поверх уже заданного вопроса.
    const resultNextStep = (!updatedCard && extraction.clarification_text) ? undefined : nextStep;

    return {
      assistantResponse,
      responseSource: "business_assistant_orchestrator",
      appliedActions,
      rejectedActions: [...errors, ...toolLayerErrors],
      nextStep: resultNextStep,
      intent: extraction.intent,
      confidence: extraction.confidence,
      assistant_stage: finalStage,
    };
  }

  private renderSimpleIntentResponse(intent: string): string {
    if (intent === "small_talk") return "Привет! Я Business Assistant AiVoX. Расскажите, чем занимается ваш бизнес — и я начну собирать карточку услуги.";
    return "AiVoX — это платформа цифровых AI-сотрудников: я настраиваю бизнес-профиль и карточки услуг, Scout ищет клиентов, Avi отвечает входящим. Опишите свой бизнес обычными словами.";
  }

  // Раздел 20.2, 22.2 ТЗ: ответ собирается из реальных сохранённых данных через
  // sanitizeForResponse — поэтому "[object Object]" архитектурно невозможен здесь,
  // а не "проверяется тестом постфактум".
  private renderResponse(
    intent: string,
    card: ProductCard | undefined,
    applied: ToolActionResult[],
    nextStep?: NextStep,
    clarificationText?: string,
    stage: AssistantStage = "profile_setup",
    wasNew: boolean = true,
  ): string {
    if (!card) {
      if (clarificationText) return clarificationText;
      // В daily_assistant режиме не повторяем инструкцию по заполнению профиля.
      if (stage === "daily_assistant") {
        return nextStep ? nextStep.question : "Слушаю. Чем могу помочь?";
      }
      // Если есть следующий шаг из существующей карточки — используем его, не generic fallback.
      if (nextStep) return nextStep.question;
      return "Расскажите о вашей услуге: название, цену и что входит в стоимость — например, «Маникюр, 1500 рублей, входит снятие лака».";
    }
    const lines: string[] = [];
    const verb = wasNew ? "Создал и заполнил" : "Обновил";
    lines.push(`Понял. ${verb} карточку «${sanitizeForResponse(card.name)}».`);
    lines.push("");
    lines.push("Записал:");
    if (card.price !== undefined) {
      lines.push(`- цена: ${sanitizeForResponse(card.price)} ${sanitizeForResponse(card.currency)}/${sanitizeForResponse(card.unit)}`);
    } else if (card.pricing_model === "custom") {
      lines.push("- цена: рассчитывается индивидуально");
    }
    if (card.includes.length) lines.push(`- входит: ${sanitizeForResponse(card.includes)}`);
    if (card.excludes.length) lines.push(`- не входит: ${sanitizeForResponse(card.excludes)}`);
    if (card.estimate_inputs.length) lines.push(`- для расчёта: ${sanitizeForResponse(card.estimate_inputs)}`);
    if (card.customer_segments.length) lines.push(`- клиенты: ${sanitizeForResponse(card.customer_segments)}`);
    if (card.geography.length) lines.push(`- география: ${sanitizeForResponse(card.geography)}`);
    if (card.scout_sources.length) lines.push(`- Scout: ${sanitizeForResponse(card.scout_sources)}`);
    if (card.avi_qualification_questions.length) lines.push(`- Avi: ${sanitizeForResponse(card.avi_qualification_questions)}`);
    // nextStep не дублируем в тексте — UI рендерит его отдельным жёлтым блоком.
    return lines.join("\n");
  }
}
