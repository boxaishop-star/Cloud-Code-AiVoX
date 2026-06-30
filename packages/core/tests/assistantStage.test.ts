import { describe, it, expect } from "vitest";
import { BusinessAssistantOrchestrator } from "../src/orchestrator.js";
import { InMemoryStore } from "../src/toolLayer.js";
import { MockExtractionProvider } from "../src/extraction/mockProvider.js";
import { checkProfileReadyForDailyAssistant } from "../src/nextStepController.js";
import type { ProductCard } from "../src/schemas/productCard.js";
import type { BusinessFoundation } from "../src/schemas/businessFoundation.js";

// Карточка с readiness_score >= 80 (заполнены первые 9 из 11 полей).
const READY_CARD: ProductCard = {
  id: "manicure",
  tenant_id: "t1",
  name: "Маникюр",
  category: "Красота и уход",
  service_line: "manicure",
  pricing_model: "fixed",
  price: 1500,
  currency: "RUB",
  includes: ["покрытие лаком"],
  excludes: ["наращивание"],
  estimate_inputs: [],
  customer_segments: ["женщины 18–45"],
  geography: ["Москва"],
  scout_search_signals: ["маникюр москва"],
  scout_sources: ["авито"],
  avi_qualification_questions: ["Когда вам удобно?"],
  handoff_to_human_rules: [],
  price_rules: [],
  variants: [],
  readiness_score: 82,
  missing_fields: ["estimate_inputs", "handoff_rules"],
  evidence: [],
  source: "business_assistant",
  created_from_conversation: true,
};

const FULL_FOUNDATION: BusinessFoundation = {
  tenant_id: "t1",
  assistant_stage: "profile_setup",
  company_description: "Мастер маникюра",
  market_type: "B2C",
  geography: ["Москва"],
};

// ── checkProfileReadyForDailyAssistant ────────────────────────────────────────

describe("checkProfileReadyForDailyAssistant", () => {
  it("возвращает true если readiness >= 80 и foundation заполнен", () => {
    expect(checkProfileReadyForDailyAssistant([READY_CARD], FULL_FOUNDATION)).toBe(true);
  });

  it("возвращает false если нет карточек", () => {
    expect(checkProfileReadyForDailyAssistant([], FULL_FOUNDATION)).toBe(false);
  });

  it("возвращает false если лучшая карточка readiness < 80", () => {
    const weakCard = { ...READY_CARD, readiness_score: 70 };
    expect(checkProfileReadyForDailyAssistant([weakCard], FULL_FOUNDATION)).toBe(false);
  });

  it("возвращает false если foundation без company_description", () => {
    const f = { ...FULL_FOUNDATION, company_description: undefined };
    expect(checkProfileReadyForDailyAssistant([READY_CARD], f)).toBe(false);
  });

  it("возвращает false если foundation без market_type", () => {
    const f = { ...FULL_FOUNDATION, market_type: undefined };
    expect(checkProfileReadyForDailyAssistant([READY_CARD], f)).toBe(false);
  });

  it("возвращает false если foundation без geography", () => {
    const f = { ...FULL_FOUNDATION, geography: [] };
    expect(checkProfileReadyForDailyAssistant([READY_CARD], f)).toBe(false);
  });

  it("возвращает false если foundation undefined", () => {
    expect(checkProfileReadyForDailyAssistant([READY_CARD], undefined)).toBe(false);
  });

  it("возвращает false если лучшая карточка без scout_search_signals — Scout без ключевых слов не может искать", () => {
    const cardWithoutScout = { ...READY_CARD, scout_search_signals: [] };
    // Даже при readiness_score >= 80 и заполненном foundation — без scout_search_signals переход запрещён.
    expect(checkProfileReadyForDailyAssistant([cardWithoutScout], FULL_FOUNDATION)).toBe(false);
  });

  it("выбирает лучшую из нескольких карточек", () => {
    const weakCard = { ...READY_CARD, service_line: "pedicure", readiness_score: 30 };
    // Одна слабая + одна сильная (с scout_search_signals) → true
    expect(checkProfileReadyForDailyAssistant([weakCard, READY_CARD], FULL_FOUNDATION)).toBe(true);
    // Обе слабые → false
    expect(checkProfileReadyForDailyAssistant([weakCard, { ...READY_CARD, readiness_score: 79 }], FULL_FOUNDATION)).toBe(false);
  });
});

// ── Orchestrator stage transition ─────────────────────────────────────────────

describe("Orchestrator: переход profile_setup → daily_assistant", () => {
  it("остаётся в profile_setup пока карточка недозаполнена", async () => {
    const store = new InMemoryStore();
    const extractor = new MockExtractionProvider({
      "маникюр": {
        intent: "business_setup",
        confidence: 0.9,
        proposed_actions: [{
          type: "upsert_product_card",
          payload: { id: "manicure", name: "Маникюр", category: "Красота", service_line: "manicure", pricing_model: "fixed", price: 1500 },
        }, {
          type: "upsert_business_foundation",
          payload: { company_description: "Мастер маникюра", market_type: "B2C", geography: ["Москва"] },
        }],
      },
    });
    const orch = new BusinessAssistantOrchestrator(store, extractor);
    const result = await orch.process({ userMessage: "делаю маникюр", tenant_id: "t_stage" });
    // readiness будет низкой (мало полей) → остаёмся в profile_setup
    expect(result.assistant_stage).toBe("profile_setup");
    expect(result.assistantResponse).not.toContain("Daily Assistant");
  });

  it("переходит в daily_assistant когда readiness >= 80 и foundation заполнен", async () => {
    const store = new InMemoryStore();

    // Предзагружаем карточку с readiness >= 80 напрямую в store.
    await store.applyAction({
      type: "upsert_product_card",
      payload: { ...READY_CARD, readiness_score: 82 },
    });
    // Предзагружаем foundation (без assistant_stage — он будет дефолтным "profile_setup").
    await store.applyAction({
      type: "upsert_business_foundation",
      payload: { ...FULL_FOUNDATION, tenant_id: "t_stage2" },
    });
    // Дублируем карточку с правильным tenant_id.
    await store.applyAction({
      type: "upsert_product_card",
      payload: { ...READY_CARD, tenant_id: "t_stage2" },
    });

    // Следующее сообщение не создаёт новых карточек — только тригерит проверку.
    const extractor = new MockExtractionProvider({
      "готово": {
        intent: "inquiry",
        confidence: 0.5,
        proposed_actions: [],
      },
    });
    const orch = new BusinessAssistantOrchestrator(store, extractor);
    const result = await orch.process({ userMessage: "всё готово?", tenant_id: "t_stage2" });

    expect(result.assistant_stage).toBe("daily_assistant");
    expect(result.assistantResponse).toContain("Daily Assistant");

    // store теперь должен хранить daily_assistant.
    const updatedFoundation = await store.getFoundation("t_stage2");
    expect((updatedFoundation as any)?.assistant_stage).toBe("daily_assistant");
  });

  it("остаётся в daily_assistant при последующих сообщениях", async () => {
    const store = new InMemoryStore();
    await store.applyAction({
      type: "upsert_business_foundation",
      payload: { ...FULL_FOUNDATION, tenant_id: "t_daily", assistant_stage: "daily_assistant" },
    });

    const extractor = new MockExtractionProvider({
      "сколько лидов": {
        intent: "inquiry",
        confidence: 0.8,
        proposed_actions: [],
      },
    });
    const orch = new BusinessAssistantOrchestrator(store, extractor);
    const result = await orch.process({ userMessage: "сколько лидов сегодня?", tenant_id: "t_daily" });

    expect(result.assistant_stage).toBe("daily_assistant");
    // Не должен выдавать инструкцию по заполнению профиля.
    expect(result.assistantResponse).not.toContain("Расскажите о вашей услуге");
  });
});
