import { classifyIntentLocally } from "./intentEngine.js";
import { validateProposedActions, sanitizeForResponse } from "./validation.js";
import { InMemoryStore } from "./toolLayer.js";
import { computeNextStep, computeReadiness } from "./nextStepController.js";
import type { ExtractionProvider } from "./extraction/types.js";
import type { ToolAction, ToolActionResult } from "./schemas/toolAction.js";
import type { NextStep } from "./nextStepController.js";

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
}

export class BusinessAssistantOrchestrator {
  constructor(private store: InMemoryStore, private extractor: ExtractionProvider) {}

  async process(input: OrchestratorInput): Promise<OrchestratorResult> {
    const local = classifyIntentLocally(input.userMessage);

    // small_talk / explain_product не идут в LLM — раздел 15.2 ТЗ (экономия на простых интентах).
    if (local.intent === "small_talk" || local.intent === "explain_product") {
      return {
        assistantResponse: this.renderSimpleIntentResponse(local.intent),
        responseSource: "business_assistant_orchestrator",
        appliedActions: [],
        rejectedActions: [],
        intent: local.intent,
        confidence: local.confidence,
      };
    }

    const existingCards = this.store.getProductCards(input.tenant_id);
    const extraction = await this.extractor.extract(input.userMessage, {
      tenant_id: input.tenant_id,
      businessFoundation: this.store.getFoundation(input.tenant_id) ?? {},
      productCatalog: existingCards,
    });

    const existingCategories = [...new Set(existingCards.map((c) => c.category))];
    const { validActions, errors } = validateProposedActions(extraction.proposed_actions, existingCards, existingCategories);

    const appliedActions = validActions.map((a) => this.store.applyAction(a));

    const updatedCard = this.store.getProductCards(input.tenant_id).find((c) =>
      validActions.some((a) => a.type === "upsert_product_card" && (a.payload as any).service_line === c.service_line),
    );
    if (updatedCard) {
      const readiness = computeReadiness(updatedCard);
      Object.assign(updatedCard, readiness);
    }

    const nextStep = updatedCard ? computeNextStep(updatedCard) : extraction.next_step;

    return {
      assistantResponse: this.renderResponse(extraction.intent, updatedCard, appliedActions, nextStep),
      responseSource: "business_assistant_orchestrator",
      appliedActions,
      rejectedActions: errors,
      intent: extraction.intent,
      confidence: extraction.confidence,
    };
  }

  private renderSimpleIntentResponse(intent: string): string {
    if (intent === "small_talk") return "Привет! Я Business Assistant AiVoX. Расскажите, чем занимается ваш бизнес — и я начну собирать карточку услуги.";
    return "AiVoX — это платформа цифровых AI-сотрудников: я настраиваю бизнес-профиль и карточки услуг, Scout ищет клиентов, Avi отвечает входящим. Опишите свой бизнес обычными словами.";
  }

  // Раздел 20.2, 22.2 ТЗ: ответ собирается из реальных сохранённых данных через
  // sanitizeForResponse — поэтому "[object Object]" архитектурно невозможен здесь,
  // а не "проверяется тестом постфактум".
  private renderResponse(intent: string, card: ReturnType<InMemoryStore["getProductCards"]>[number] | undefined, applied: ToolActionResult[], nextStep?: NextStep): string {
    if (!card) {
      return "Понял. Расскажите подробнее про услугу, которую настраиваем — название, цену и что входит в стоимость.";
    }
    const lines: string[] = [];
    lines.push(`Понял. Создал и заполнил карточку «${sanitizeForResponse(card.name)}».`);
    lines.push("");
    lines.push("Записал:");
    if (card.price !== undefined) lines.push(`- цена: ${sanitizeForResponse(card.price)} ${sanitizeForResponse(card.currency)}/${sanitizeForResponse(card.unit)}`);
    if (card.includes.length) lines.push(`- входит: ${sanitizeForResponse(card.includes)}`);
    if (card.excludes.length) lines.push(`- не входит: ${sanitizeForResponse(card.excludes)}`);
    if (card.estimate_inputs.length) lines.push(`- для расчёта: ${sanitizeForResponse(card.estimate_inputs)}`);
    if (card.customer_segments.length) lines.push(`- клиенты: ${sanitizeForResponse(card.customer_segments)}`);
    if (card.geography.length) lines.push(`- география: ${sanitizeForResponse(card.geography)}`);
    if (card.scout_sources.length) lines.push(`- Scout: ${sanitizeForResponse(card.scout_sources)}`);
    if (card.avi_qualification_questions.length) lines.push(`- Avi: ${sanitizeForResponse(card.avi_qualification_questions)}`);
    if (nextStep) {
      lines.push("");
      lines.push(nextStep.question);
    }
    return lines.join("\n");
  }
}
