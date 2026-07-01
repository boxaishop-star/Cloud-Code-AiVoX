import { describe, it, expect } from "vitest";
import { BusinessAssistantOrchestrator } from "../src/orchestrator.js";
import { InMemoryStore } from "../src/toolLayer.js";
import { MockExtractionProvider } from "../src/extraction/mockProvider.js";
import { checkProfileReadyForDailyAssistant } from "../src/nextStepController.js";
import { validateProposedActions } from "../src/validation.js";
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

  // Placeholder-защита gate A→B (раздел 7.1.2 ТЗ v9.1).
  // Тот же список placeholder'ов что и в isFoundationComplete — источник: utils/placeholders.ts.
  it('возвращает false если company_description = "<UNKNOWN>"', () => {
    const f = { ...FULL_FOUNDATION, company_description: "<UNKNOWN>" };
    expect(checkProfileReadyForDailyAssistant([READY_CARD], f)).toBe(false);
  });

  it('возвращает false если company_description = "unknown" (case-insensitive)', () => {
    const f = { ...FULL_FOUNDATION, company_description: "UNKNOWN" };
    expect(checkProfileReadyForDailyAssistant([READY_CARD], f)).toBe(false);
  });

  it('возвращает false если company_description = "-"', () => {
    const f = { ...FULL_FOUNDATION, company_description: "-" };
    expect(checkProfileReadyForDailyAssistant([READY_CARD], f)).toBe(false);
  });

  it('возвращает false если geography = ["<UNKNOWN>"]', () => {
    const f = { ...FULL_FOUNDATION, geography: ["<UNKNOWN>"] };
    expect(checkProfileReadyForDailyAssistant([READY_CARD], f)).toBe(false);
  });

  it('возвращает false если geography = ["-"]', () => {
    const f = { ...FULL_FOUNDATION, geography: ["-"] };
    expect(checkProfileReadyForDailyAssistant([READY_CARD], f)).toBe(false);
  });

  it('возвращает true если geography = ["<UNKNOWN>", "Москва"] (есть реальный регион)', () => {
    const f = { ...FULL_FOUNDATION, geography: ["<UNKNOWN>", "Москва"] };
    expect(checkProfileReadyForDailyAssistant([READY_CARD], f)).toBe(true);
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

// ── isFoundationComplete placeholder rejection ────────────────────────────────

// isFoundationComplete is not exported; test via the orchestrator gate:
// seed a foundation with placeholder values, then try to create a card.

describe("isFoundationComplete: placeholder values не засчитываются (раздел 7.1.2 ТЗ v9.1)", () => {
  async function cardCountWithFoundation(foundationPayload: Record<string, unknown>): Promise<number> {
    const store = new InMemoryStore();
    await store.applyAction({
      type: "upsert_business_foundation",
      payload: { tenant_id: "t_ph", ...foundationPayload },
    });
    const extractor = new MockExtractionProvider({
      "услуга": {
        intent: "business_setup",
        confidence: 0.9,
        proposed_actions: [{
          type: "upsert_product_card",
          payload: { id: "svc", name: "Услуга", category: "Кат", service_line: "svc", pricing_model: "fixed", price: 100 },
        }],
      },
    });
    const orch = new BusinessAssistantOrchestrator(store, extractor);
    await orch.process({ userMessage: "услуга", tenant_id: "t_ph" });
    return (await store.getProductCards("t_ph")).length;
  }

  it('geography: ["<UNKNOWN>"] блокирует создание карточки', async () => {
    expect(await cardCountWithFoundation({ company_description: "Тест", market_type: "B2C", geography: ["<UNKNOWN>"] })).toBe(0);
  });

  it('geography: ["unknown"] блокирует создание карточки', async () => {
    expect(await cardCountWithFoundation({ company_description: "Тест", market_type: "B2C", geography: ["unknown"] })).toBe(0);
  });

  it('geography: ["-"] блокирует создание карточки', async () => {
    expect(await cardCountWithFoundation({ company_description: "Тест", market_type: "B2C", geography: ["-"] })).toBe(0);
  });

  it('geography: [""] (пустая строка) блокирует создание карточки', async () => {
    expect(await cardCountWithFoundation({ company_description: "Тест", market_type: "B2C", geography: [""] })).toBe(0);
  });

  it('company_description: "<UNKNOWN>" блокирует создание карточки', async () => {
    expect(await cardCountWithFoundation({ company_description: "<UNKNOWN>", market_type: "B2C", geography: ["Москва"] })).toBe(0);
  });

  it('реальные значения ("Москва") разрешают создание карточки', async () => {
    expect(await cardCountWithFoundation({ company_description: "Строительство фундаментов", market_type: "B2C", geography: ["Москва"] })).toBe(1);
  });

  it('смешанный массив ["<UNKNOWN>", "Москва"] разрешает создание (есть реальный регион)', async () => {
    expect(await cardCountWithFoundation({ company_description: "Тест", market_type: "B2C", geography: ["<UNKNOWN>", "Москва"] })).toBe(1);
  });
});

// ── Foundation Gate (раздел 7.1.2 ТЗ v9.1) ───────────────────────────────────

describe("Foundation Gate: validateProposedActions", () => {
  const CARD_ACTION = {
    type: "upsert_product_card" as const,
    payload: { id: "svc", name: "Услуга", category: "Категория", service_line: "svc", pricing_model: "fixed" as const, price: 1000 },
  };
  const FOUNDATION_ACTION = {
    type: "upsert_business_foundation" as const,
    payload: { company_description: "Тест", market_type: "B2C" as const, geography: ["Москва"] },
  };

  it("блокирует upsert_product_card когда foundationComplete=false", () => {
    const { validActions, errors } = validateProposedActions(
      [CARD_ACTION],
      [],
      [],
      { foundationComplete: false },
    );
    expect(validActions).toHaveLength(0);
    expect(errors[0]).toContain("BusinessFoundation не заполнен");
  });

  it("разрешает upsert_product_card когда foundationComplete=true", () => {
    const { validActions, errors } = validateProposedActions(
      [CARD_ACTION],
      [],
      [],
      { foundationComplete: true },
    );
    expect(validActions).toHaveLength(1);
    expect(errors).toHaveLength(0);
  });

  it("разрешает upsert_business_foundation независимо от foundationComplete", () => {
    const { validActions, errors } = validateProposedActions(
      [FOUNDATION_ACTION],
      [],
      [],
      { foundationComplete: false },
    );
    expect(validActions).toHaveLength(1);
    expect(errors).toHaveLength(0);
  });

  it("disambiguation: блокирует upsert_product_card с другим service_line и выставляет disambiguationNeeded", () => {
    const { validActions, errors, disambiguationNeeded } = validateProposedActions(
      [{ ...CARD_ACTION, payload: { ...CARD_ACTION.payload, service_line: "new_svc" } }],
      [],
      [],
      { foundationComplete: true, activeServiceLine: "existing_svc" },
    );
    expect(validActions).toHaveLength(0);
    expect(disambiguationNeeded).toBe(true);
    expect(errors[0]).toContain("активной услугой");
  });

  it("разрешает update_product_card для activeServiceLine", () => {
    const updateAction = {
      type: "update_product_card" as const,
      payload: { service_line: "existing_svc", tenant_id: "t", price: 2000 },
    };
    const { validActions } = validateProposedActions(
      [updateAction],
      [],
      [],
      { foundationComplete: true, activeServiceLine: "existing_svc" },
    );
    expect(validActions).toHaveLength(1);
  });
});

describe("Foundation Gate: Orchestrator projected check", () => {
  it("блокирует карточку когда foundation не заполнен и нет foundation-акции в батче", async () => {
    const store = new InMemoryStore();
    const extractor = new MockExtractionProvider({
      "маникюр": {
        intent: "business_setup",
        confidence: 0.9,
        proposed_actions: [{
          type: "upsert_product_card",
          payload: { id: "manicure", name: "Маникюр", category: "Красота", service_line: "manicure", pricing_model: "fixed", price: 1500 },
        }],
      },
    });
    const orch = new BusinessAssistantOrchestrator(store, extractor);
    const result = await orch.process({ userMessage: "делаю маникюр 1500р", tenant_id: "t_gate_block" });

    const cards = await store.getProductCards("t_gate_block");
    expect(cards).toHaveLength(0);
    expect(result.rejectedActions.some(e => e.includes("BusinessFoundation не заполнен"))).toBe(true);
  });

  it("разрешает карточку в одном батче с полной foundation-акцией (projected check)", async () => {
    const store = new InMemoryStore();
    const extractor = new MockExtractionProvider({
      "маникюр": {
        intent: "business_setup",
        confidence: 0.9,
        proposed_actions: [
          {
            type: "upsert_business_foundation",
            payload: { company_description: "Мастер маникюра", market_type: "B2C", geography: ["Москва"] },
          },
          {
            type: "upsert_product_card",
            payload: { id: "manicure", name: "Маникюр", category: "Красота", service_line: "manicure", pricing_model: "fixed", price: 1500 },
          },
        ],
      },
    });
    const orch = new BusinessAssistantOrchestrator(store, extractor);
    await orch.process({ userMessage: "делаю маникюр 1500р", tenant_id: "t_gate_allow" });

    const cards = await store.getProductCards("t_gate_allow");
    expect(cards).toHaveLength(1);
  });
});
