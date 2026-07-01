import { classifyIntentLocally } from "./intentEngine.js";
import { validateProposedActions, sanitizeForResponse } from "./validation.js";
import { computeNextStep, computeReadiness, checkProfileReadyForDailyAssistant, pickBestCard, resolveNichePack } from "./nextStepController.js";
import { isRealValue, hasRealValue } from "./utils/placeholders.js";
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
  /** When set, orchestrator treats this service as the one currently being built. */
  activeServiceLine?: string;
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

// ── Foundation helpers ─────────────────────────────────────────────────────────

/** Раздел 7.1.2 ТЗ v9.1: минимум для снятия блока на создание карточек.
 *  Placeholder-значения ("unknown", "<UNKNOWN>", "-" и т.п.) не засчитываются —
 *  фильтрация делегирована в utils/placeholders.ts (единый список для обоих gate'ов). */
function isFoundationComplete(foundation: Record<string, unknown> | null | undefined): boolean {
  if (!foundation) return false;
  const f = foundation as Record<string, unknown>;
  if (!isRealValue(f.company_description)) return false;
  if (!f.market_type) return false;
  return hasRealValue(f.geography as string[] | undefined);
}

/** Следующий вопрос для сбора недостающих полей BusinessFoundation. */
function nextFoundationQuestion(foundation: Record<string, unknown> | null | undefined): string {
  const f = (foundation ?? {}) as Record<string, unknown>;
  if (!f.company_description) return "Расскажите подробнее о своём бизнесе — чем занимаетесь и кто ваши клиенты?";
  if (!f.market_type) return "Вы работаете с частными лицами (B2C) или с компаниями (B2B)?";
  if (!(f.geography as string[] | undefined)?.length) return "В каких городах или регионах работаете?";
  return "Расскажите об основной услуге — как она называется?";
}

// ── Orchestrator ───────────────────────────────────────────────────────────────

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

    // ── Раздел 7.1.2 ТЗ v9.1: Foundation gate ─────────────────────────────────
    // Блокирует создание ProductCard до тех пор, пока не собраны
    // company_description + market_type + geography. Проверяется ДО extraction.
    const foundationComplete = isFoundationComplete(foundation);

    // Активная услуга: либо передана UI явно, либо вычисляется как лучшая карточка в profile_setup.
    const derivedActiveServiceLine = input.activeServiceLine
      ?? (currentStage === "profile_setup"
        ? pickBestCard(existingCards)?.service_line
        : undefined);

    // Передаём missing_fields лучшей карточки в контекст провайдера —
    // модель точно знает, каких данных не хватает, и не повторяет одни вопросы.
    const bestExisting = pickBestCard(existingCards);
    const { missing_fields: contextMissingFields } = bestExisting
      ? computeReadiness(bestExisting)
      : { missing_fields: [] };

    const nichePack = resolveNichePack(bestExisting, foundation ?? undefined);

    const extraction = await this.extractor.extract(input.userMessage, {
      tenant_id: input.tenant_id,
      businessFoundation: foundation ?? {},
      productCatalog: existingCards,
      assistant_stage: currentStage,
      missing_fields: contextMissingFields,
      foundationComplete,
      activeServiceLine: derivedActiveServiceLine,
      nichePack,
    });

    // Projected foundation: если в этом же батче есть foundation-акция,
    // и она закрывает все обязательные поля — снимаем gate для карточки.
    // Позволяет создать foundation + первую карточку в одном сообщении,
    // когда пользователь сразу дал все данные.
    const projectedFoundation = extraction.proposed_actions
      .filter((a) => a.type === "upsert_business_foundation")
      .reduce(
        (acc, a) => ({ ...acc, ...(a.payload as Record<string, unknown>) }),
        { ...((foundation ?? {}) as Record<string, unknown>) },
      );
    const effectiveFoundationComplete = isFoundationComplete(projectedFoundation);

    const existingCategories = [...new Set(existingCards.map((c) => c.category))];
    const { validActions, errors, disambiguationNeeded } = validateProposedActions(
      extraction.proposed_actions,
      existingCards,
      existingCategories,
      { foundationComplete: effectiveFoundationComplete, activeServiceLine: derivedActiveServiceLine },
    );

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

    // Определяем создание vs обновление — влияет на формулировку ответа.
    const wasNewCard = touchedServiceLine
      ? !existingCards.some((c) => c.service_line === touchedServiceLine)
      : false;

    // Если нет явного updatedCard, пробуем подтянуть следующий шаг из лучшей существующей карточки.
    const bestFreshCard = pickBestCard(freshCards);
    const nextStep = updatedCard
      ? computeNextStep(updatedCard)
      : extraction.next_step ?? (bestFreshCard ? computeNextStep(bestFreshCard) : undefined);

    // ── Проверка перехода A→B (раздел 7.1.1 ТЗ v9.0) ─────────────────────────
    let finalStage: AssistantStage = currentStage;
    let stageTransitionMessage: string | undefined;

    const freshFoundation = await this.store.getFoundation(input.tenant_id);

    if (currentStage === "profile_setup") {
      if (checkProfileReadyForDailyAssistant(freshCards, freshFoundation)) {
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

    // ── Формирование ответа ────────────────────────────────────────────────────

    // Свежее состояние foundation после применения акций.
    const freshFoundationComplete = isFoundationComplete(freshFoundation);
    const foundationJustCompleted = !foundationComplete && freshFoundationComplete;
    const foundationApplied = appliedActions.some(
      (r) => r.action.type === "upsert_business_foundation" && r.applied,
    );

    let baseResponse: string;

    // Приоритет 1: disambiguation — пользователь упомянул другую услугу, нужно уточнение.
    if (disambiguationNeeded && derivedActiveServiceLine && !updatedCard) {
      const activeCard = freshCards.find((c) => c.service_line === derivedActiveServiceLine);
      const activeName = activeCard?.name ?? derivedActiveServiceLine;
      baseResponse = extraction.clarification_text
        ?? `Уточните: это дополнение к «${sanitizeForResponse(activeName)}» или вы хотите добавить отдельную новую услугу?`;
    // Приоритет 2: foundation только что закрылась — переходим к сбору карточки.
    } else if (foundationJustCompleted && !updatedCard && !extraction.clarification_text) {
      baseResponse = "Отлично, записал основное о бизнесе. Теперь расскажите об основной услуге — как она называется?";
    // Приоритет 3: foundation обновлена, но ещё не закрыта — спрашиваем следующее обязательное поле.
    } else if (foundationApplied && !freshFoundationComplete && !updatedCard && !extraction.clarification_text) {
      baseResponse = nextFoundationQuestion(freshFoundation);
    // Приоритет 4: стандартный рендеринг.
    } else {
      baseResponse = this.renderResponse(extraction.intent, updatedCard, appliedActions, nextStep, extraction.clarification_text, currentStage, wasNewCard);
    }

    const assistantResponse = stageTransitionMessage
      ? `${stageTransitionMessage}\n\n${baseResponse}`
      : baseResponse;

    // Yellow block появляется ТОЛЬКО рядом с карточкой услуги — во всех остальных случаях
    // (clarification, foundation вопросы, no-card) вопрос уже встроен в текст ответа,
    // и дублировать его отдельным блоком нельзя.
    const resultNextStep = updatedCard ? nextStep : undefined;

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
  // sanitizeForResponse — поэтому "[object Object]" архитектурно невозможен здесь.
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
      if (stage === "daily_assistant") {
        return nextStep ? nextStep.question : "Слушаю. Чем могу помочь?";
      }
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
