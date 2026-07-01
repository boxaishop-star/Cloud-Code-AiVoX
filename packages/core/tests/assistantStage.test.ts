import { describe, it, expect } from "vitest";
import { BusinessAssistantOrchestrator } from "../src/orchestrator.js";
import { InMemoryStore } from "../src/toolLayer.js";
import { MockExtractionProvider } from "../src/extraction/mockProvider.js";
import { checkProfileReadyForDailyAssistant, pickBestCard } from "../src/nextStepController.js";
import { validateProposedActions } from "../src/validation.js";
import type { ProductCard } from "../src/schemas/productCard.js";
import type { BusinessFoundation } from "../src/schemas/businessFoundation.js";

// Карточка с реальным readiness >= 80 (computeReadiness даёт 90%: 9/10 done, estimate_inputs skipped).
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
    // service+price+scout_signals+geography = 4/10 = 40% < 80
    const weakCard = { ...READY_CARD, includes: [], excludes: [], customer_segments: [], scout_sources: [], avi_qualification_questions: [] };
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
    // service+price+scout_signals+geography = 4/10 = 40%
    const weakCard = { ...READY_CARD, service_line: "pedicure", includes: [], excludes: [], customer_segments: [], scout_sources: [], avi_qualification_questions: [] };
    // Одна слабая + одна сильная (с scout_search_signals) → true
    expect(checkProfileReadyForDailyAssistant([weakCard, READY_CARD], FULL_FOUNDATION)).toBe(true);
    // Обе слабые → false: service+price+scout_signals+geography+includes = 5/10 = 50%
    const anotherWeak = { ...READY_CARD, excludes: [], customer_segments: [], scout_sources: [], avi_qualification_questions: [] };
    expect(checkProfileReadyForDailyAssistant([weakCard, anotherWeak], FULL_FOUNDATION)).toBe(false);
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

// ── pickBestCard: регрессия выбора по реальному readiness ────────────────────

describe("pickBestCard: выбирает по computeReadiness, не по хранимому полю (раздел 7.1.2 ТЗ v9.1)", () => {
  it("возвращает undefined для пустого массива", () => {
    expect(pickBestCard([])).toBeUndefined();
  });

  it("единственная карточка → она и возвращается", () => {
    expect(pickBestCard([READY_CARD])).toBe(READY_CARD);
  });

  it("тенант с 2 карточками: выбирает ту, что реально заполнена лучше, независимо от порядка", () => {
    // READY_CARD: 9/10 = 90%, service_line="manicure"
    // lowCard: service+price+scout_signals+geography = 4/10 = 40%, service_line="pedicure"
    const lowCard = {
      ...READY_CARD,
      service_line: "pedicure",
      name: "Педикюр",
      includes: [], excludes: [], customer_segments: [], scout_sources: [], avi_qualification_questions: [],
    };
    // Педикюр стоит первым в массиве (симулируем «первую созданную карточку») — должен выиграть Маникюр
    expect(pickBestCard([lowCard, READY_CARD])?.service_line).toBe("manicure");
    expect(pickBestCard([READY_CARD, lowCard])?.service_line).toBe("manicure");
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

  it("checkProfileReadyForDailyAssistant=true при readiness >= 80 и заполненном foundation; ручная активация переводит в daily_assistant", async () => {
    const store = new InMemoryStore();

    await store.applyAction({
      type: "upsert_business_foundation",
      payload: { ...FULL_FOUNDATION, tenant_id: "t_stage2" },
    });
    await store.applyAction({
      type: "upsert_product_card",
      payload: { ...READY_CARD, tenant_id: "t_stage2" },
    });

    const extractor = new MockExtractionProvider({
      "готово": { intent: "inquiry", confidence: 0.5, proposed_actions: [] },
    });
    const orch = new BusinessAssistantOrchestrator(store, extractor);
    const result = await orch.process({ userMessage: "всё готово?", tenant_id: "t_stage2" });

    // Без авто-перехода: стадия остаётся profile_setup после process().
    expect(result.assistant_stage).toBe("profile_setup");

    // checkProfileReadyForDailyAssistant должна вернуть true.
    const cards = await store.getProductCards("t_stage2");
    const foundation = await store.getFoundation("t_stage2");
    expect(checkProfileReadyForDailyAssistant(cards, foundation ?? undefined)).toBe(true);

    // Ручная активация через store.
    await store.applyAction({
      type: "upsert_business_foundation",
      payload: { tenant_id: "t_stage2", assistant_stage: "daily_assistant" },
    });
    const updated = await store.getFoundation("t_stage2") as any;
    expect(updated?.assistant_stage).toBe("daily_assistant");
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

// ── Фаза 1: защита update_product_card от потери данных (раздел 7.1.2 ТЗ v9.1) ──

describe("update_product_card: защита от потери данных при коррекции", () => {
  const BASE_PAYLOAD = {
    id: "nail_ext",
    name: "Наращивание ногтей",
    category: "Красота и уход",
    service_line: "nail_ext",
    pricing_model: "fixed" as const,
    price: 2500,
    includes: ["снятие покрытия", "опил формы", "стерилизация инструментов"],
  };

  it("пустой includes в update не стирает существующий includes", async () => {
    const store = new InMemoryStore();
    await store.applyAction({ type: "upsert_product_card", payload: { ...BASE_PAYLOAD, tenant_id: "t_upd" } });

    await store.applyAction({
      type: "update_product_card",
      payload: { tenant_id: "t_upd", service_line: "nail_ext", includes: [] },
    });

    const [card] = await store.getProductCards("t_upd");
    expect(card.includes).toEqual(["снятие покрытия", "опил формы", "стерилизация инструментов"]);
  });

  it("непустой includes в update корректно заменяет существующий", async () => {
    const store = new InMemoryStore();
    await store.applyAction({ type: "upsert_product_card", payload: { ...BASE_PAYLOAD, tenant_id: "t_upd2" } });

    await store.applyAction({
      type: "update_product_card",
      payload: { tenant_id: "t_upd2", service_line: "nail_ext", includes: ["новый состав"] },
    });

    const [card] = await store.getProductCards("t_upd2");
    expect(card.includes).toEqual(["новый состав"]);
  });

  it("пустые arrays в нескольких полях одновременно — все сохраняются", async () => {
    const store = new InMemoryStore();
    await store.applyAction({
      type: "upsert_product_card",
      payload: {
        ...BASE_PAYLOAD,
        tenant_id: "t_upd3",
        excludes: ["дизайн со стразами"],
        scout_search_signals: ["наращивание ногтей москва"],
      },
    });

    await store.applyAction({
      type: "update_product_card",
      payload: {
        tenant_id: "t_upd3",
        service_line: "nail_ext",
        includes: [],
        excludes: [],
        scout_search_signals: [],
        price: 3000,
      },
    });

    const [card] = await store.getProductCards("t_upd3");
    expect(card.includes).toEqual(["снятие покрытия", "опил формы", "стерилизация инструментов"]);
    expect(card.excludes).toEqual(["дизайн со стразами"]);
    expect(card.scout_search_signals).toEqual(["наращивание ногтей москва"]);
    expect(card.price).toBe(3000); // скалярное поле обновляется нормально
  });
});

describe("Gate 2b: update_product_card с другим name/category → disambiguationNeeded", () => {
  const EXISTING_NAIL = {
    id: "nail_ext",
    tenant_id: "t",
    name: "Наращивание ногтей",
    category: "Красота и уход",
    service_line: "nail_ext",
    pricing_model: "fixed" as const,
    price: 2500,
    currency: "RUB",
    includes: [],
    excludes: [],
    estimate_inputs: [],
    customer_segments: [],
    geography: [],
    scout_search_signals: [],
    scout_sources: [],
    avi_qualification_questions: [],
    handoff_to_human_rules: [],
    price_rules: [],
    variants: [],
    evidence: [],
    source: "business_assistant" as const,
    created_from_conversation: true,
  };

  it("смена name на принципиально другое → disambiguationNeeded=true, карточка не обновлена", () => {
    const { validActions, errors, disambiguationNeeded } = validateProposedActions(
      [{ type: "update_product_card", payload: { tenant_id: "t", service_line: "nail_ext", name: "Педикюр" } }],
      [EXISTING_NAIL],
      [],
    );
    expect(disambiguationNeeded).toBe(true);
    expect(validActions).toHaveLength(0);
    expect(errors[0]).toContain("существенно отличается");
  });

  it("смена category на другую → disambiguationNeeded=true", () => {
    const { validActions, disambiguationNeeded } = validateProposedActions(
      [{ type: "update_product_card", payload: { tenant_id: "t", service_line: "nail_ext", category: "Строительство" } }],
      [EXISTING_NAIL],
      [],
    );
    expect(disambiguationNeeded).toBe(true);
    expect(validActions).toHaveLength(0);
  });

  it("уточнение name (подстрока) → OK, не disambiguation", () => {
    const { validActions, disambiguationNeeded } = validateProposedActions(
      [{ type: "update_product_card", payload: { tenant_id: "t", service_line: "nail_ext", name: "Наращивание ногтей гелем" } }],
      [EXISTING_NAIL],
      [],
    );
    expect(disambiguationNeeded).toBe(false);
    expect(validActions).toHaveLength(1);
  });

  it("update без name/category → OK, не disambiguation", () => {
    const { validActions, disambiguationNeeded } = validateProposedActions(
      [{ type: "update_product_card", payload: { tenant_id: "t", service_line: "nail_ext", price: 3000 } }],
      [EXISTING_NAIL],
      [],
    );
    expect(disambiguationNeeded).toBe(false);
    expect(validActions).toHaveLength(1);
  });
});

describe("Фаза 1: сценарий ответ-на-вопрос → коррекция услуги (раздел 7.1.2 ТЗ v9.1)", () => {
  it("includes сохраняются после попытки сменить услугу через update", async () => {
    const store = new InMemoryStore();

    // Шаг 1: создаём карточку «Наращивание ногтей»
    await store.applyAction({
      type: "upsert_business_foundation",
      payload: { tenant_id: "t_s1", company_description: "Мастер ногтей", market_type: "B2C", geography: ["Москва"] },
    });
    await store.applyAction({
      type: "upsert_product_card",
      payload: { id: "nail_ext", name: "Наращивание ногтей", category: "Красота и уход", service_line: "nail_ext", pricing_model: "fixed", price: 2500, tenant_id: "t_s1" },
    });

    // Шаг 2: пользователь отвечает «что входит» → includes заполняются
    await store.applyAction({
      type: "update_product_card",
      payload: { tenant_id: "t_s1", service_line: "nail_ext", includes: ["снятие покрытия", "опил формы"] },
    });

    // Шаг 3: модель пытается переписать на «Педикюр» через update с пустым includes
    // Gate 2b должен заблокировать смену name; пустой includes не стирает данные
    const extractor = new MockExtractionProvider({
      "педикюр": {
        intent: "business_setup",
        confidence: 0.9,
        proposed_actions: [{
          type: "update_product_card",
          payload: { service_line: "nail_ext", name: "Педикюр", category: "Педикюр", includes: [] },
        }],
      },
    });
    const orch = new BusinessAssistantOrchestrator(store, extractor);
    const result = await orch.process({ userMessage: "педикюр", tenant_id: "t_s1" });

    // (а) includes не исчезли
    const [card] = await store.getProductCards("t_s1");
    expect(card.includes).toEqual(["снятие покрытия", "опил формы"]);

    // (б) name не превратилось в «Педикюр» без явного вопроса-уточнения
    expect(card.name).toBe("Наращивание ногтей");
    expect(result.rejectedActions.some(e => e.includes("существенно отличается"))).toBe(true);
  });
});

// ── Фаза 2: расплывчатые ответы не считаются заполненными (раздел 7.1.2 ТЗ v9.1) ──

import { computeNextStep, computeReadiness, SETUP_PLAN, resolveNichePack, NICHE_PACKS } from "../src/nextStepController.js";
import { isVagueOnly } from "../src/utils/vaguePhrases.js";

const NAIL_BASE: ProductCard = {
  id: "nail_ext",
  tenant_id: "t",
  name: "Наращивание ногтей",
  category: "Красота и уход",
  service_line: "nail_ext",
  pricing_model: "fixed",
  price: 2500,
  currency: "RUB",
  includes: [],
  excludes: [],
  estimate_inputs: [],
  customer_segments: [],
  geography: [],
  scout_search_signals: [],
  scout_sources: [],
  avi_qualification_questions: [],
  handoff_to_human_rules: [],
  price_rules: [],
  variants: [],
  evidence: [],
  source: "business_assistant",
  created_from_conversation: true,
};

describe("isVagueOnly", () => {
  it("расплывчатая-only фраза → true", () => {
    expect(isVagueOnly(["всё включено"])).toBe(true);
    expect(isVagueOnly(["по договоренности"])).toBe(true);
    expect(isVagueOnly(["стандартно", "как обычно"])).toBe(true);
  });

  it("конкретный ответ → false", () => {
    expect(isVagueOnly(["снятие покрытия", "опил формы"])).toBe(false);
  });

  it("смешанный (конкретное + расплывчатое) → false (есть конкретика)", () => {
    expect(isVagueOnly(["снятие покрытия", "всё включено"])).toBe(false);
  });

  it("пустой массив → false", () => {
    expect(isVagueOnly([])).toBe(false);
    expect(isVagueOnly(undefined)).toBe(false);
  });
});

describe("computeReadiness: расплывчатые ответы не засчитываются", () => {
  it("includes: ['всё включено'] → поле считается незаполненным", () => {
    const card = { ...NAIL_BASE, includes: ["всё включено"], price: 2500 };
    const { missing_fields } = computeReadiness(card);
    expect(missing_fields).toContain("includes");
  });

  it("scout_search_signals: ['по договоренности'] → поле незаполнено", () => {
    const card = { ...NAIL_BASE, scout_search_signals: ["по договоренности"] };
    const { missing_fields } = computeReadiness(card);
    expect(missing_fields).toContain("scout_signals");
  });

  it("avi_qualification_questions: ['разное'] → поле незаполнено", () => {
    const card = { ...NAIL_BASE, avi_qualification_questions: ["разное"] };
    const { missing_fields } = computeReadiness(card);
    expect(missing_fields).toContain("avi_questions");
  });

  it("конкретный includes → поле засчитывается", () => {
    const card = { ...NAIL_BASE, includes: ["снятие покрытия", "опил формы"], price: 2500 };
    const { missing_fields } = computeReadiness(card);
    expect(missing_fields).not.toContain("includes");
  });

  it("расплывчатый excludes не блокирует карточку → readiness_score ниже без него", () => {
    const vagueCard = { ...NAIL_BASE, includes: ["снятие покрытия"], excludes: ["обсуждается"], price: 2500 };
    const concreteCard = { ...NAIL_BASE, includes: ["снятие покрытия"], excludes: ["дизайн со стразами"], price: 2500 };
    expect(computeReadiness(vagueCard).missing_fields).toContain("excludes");
    expect(computeReadiness(concreteCard).missing_fields).not.toContain("excludes");
  });
});

describe("computeNextStep: расплывчатый ответ → тот же вопрос снова", () => {
  it("includes = ['всё включено'] → nextStep.id = includes", () => {
    const card = { ...NAIL_BASE, price: 2500, includes: ["всё включено"] };
    const step = computeNextStep(card);
    expect(step?.id).toBe("includes");
  });

  it("scout_signals = ['стандартно'] → nextStep.id = scout_signals", () => {
    const card = {
      ...NAIL_BASE,
      price: 2500,
      includes: ["снятие покрытия"],
      excludes: ["дизайн"],
      estimate_inputs: ["длина"],
      scout_search_signals: ["стандартно"],
    };
    const step = computeNextStep(card);
    expect(step?.id).toBe("scout_signals");
  });
});

// ── Фаза 3: SETUP_PLAN — статусы узлов и новый формат computeReadiness ─────────

describe("SETUP_PLAN: структура и содержание", () => {
  it("все 11 узлов присутствуют с id, question и example", () => {
    const ids = SETUP_PLAN.map(n => n.id);
    expect(ids).toEqual([
      "service", "price", "includes", "excludes", "estimate_inputs",
      "scout_signals", "customer_segments", "geography", "scout_sources",
      "avi_questions", "handoff_rules",
    ]);
    for (const node of SETUP_PLAN) {
      expect(node.question.length).toBeGreaterThan(5);
      expect(node.example.length).toBeGreaterThan(3);
    }
  });

  it("price: isApplicable=false для custom pricing", () => {
    const customCard = { ...NAIL_BASE, pricing_model: "custom" as const };
    const priceNode = SETUP_PLAN.find(n => n.id === "price")!;
    expect(priceNode.isApplicable(customCard)).toBe(false);
  });

  it("price: isApplicable=true для from_price (не только для fixed)", () => {
    const fromPriceCard = { ...NAIL_BASE, pricing_model: "from_price" as const };
    const priceNode = SETUP_PLAN.find(n => n.id === "price")!;
    expect(priceNode.isApplicable(fromPriceCard)).toBe(true);
  });

  it("estimate_inputs: isApplicable только для custom pricing", () => {
    const customCard = { ...NAIL_BASE, pricing_model: "custom" as const };
    const fixedCard = { ...NAIL_BASE, pricing_model: "fixed" as const };
    const node = SETUP_PLAN.find(n => n.id === "estimate_inputs")!;
    expect(node.isApplicable(customCard)).toBe(true);
    expect(node.isApplicable(fixedCard)).toBe(false);
  });

  it("includes: isSpecificEnough=false для vague-only", () => {
    const vagueCard = { ...NAIL_BASE, includes: ["всё включено"] };
    const node = SETUP_PLAN.find(n => n.id === "includes")!;
    expect(node.isFilled(vagueCard)).toBe(true);
    expect(node.isSpecificEnough(vagueCard)).toBe(false);
  });
});

describe("computeReadiness: возвращает plan с NodeStatus", () => {
  it("карточка без name — узел 'service' current, остальные 'upcoming'", () => {
    const blankCard = { ...NAIL_BASE, name: "" };
    const { plan } = computeReadiness(blankCard);
    expect(plan.find(n => n.id === "service")?.status).toBe("current");
    expect(plan.filter(n => n.status === "upcoming").length).toBeGreaterThan(0);
  });

  it("estimate_inputs: status='skipped' для fixed pricing", () => {
    const { plan } = computeReadiness({ ...NAIL_BASE, pricing_model: "fixed", price: 2500 });
    const node = plan.find(n => n.id === "estimate_inputs")!;
    expect(node.status).toBe("skipped");
  });

  it("estimate_inputs: status='current' для custom pricing когда не заполнено", () => {
    const card = { ...NAIL_BASE, pricing_model: "custom" as const, name: "Нарашивание", includes: ["снятие"] };
    // Карточка: service=done, price=skipped, includes=done → estimate_inputs=current
    const { plan } = computeReadiness(card);
    const node = plan.find(n => n.id === "estimate_inputs")!;
    expect(node.status).not.toBe("skipped");
  });

  it("readiness_score=100 когда все applicable узлы done", () => {
    const full: ProductCard = {
      ...NAIL_BASE,
      name: "Наращивание",
      pricing_model: "fixed",
      price: 2500,
      includes: ["снятие покрытия"],
      excludes: ["дизайн"],
      scout_search_signals: ["наращивание ногтей москва"],
      customer_segments: ["женщины 25-40"],
      geography: ["Москва"],
      scout_sources: ["ВКонтакте"],
      avi_qualification_questions: ["дата записи"],
      handoff_to_human_rules: ["жалоба клиента"],
    };
    const { readiness_score } = computeReadiness(full);
    expect(readiness_score).toBe(100);
  });

  it("missing_fields не включает skipped узлы", () => {
    const { missing_fields } = computeReadiness({ ...NAIL_BASE, pricing_model: "fixed", price: 2500 });
    expect(missing_fields).not.toContain("estimate_inputs");
  });

  it("plan содержит question и example для каждого узла", () => {
    const { plan } = computeReadiness(NAIL_BASE);
    for (const node of plan) {
      expect(node.question).toBeTruthy();
      expect(node.example).toBeTruthy();
    }
  });
});

// ── Раздел 6, 7.1.2 ТЗ v9.1: изоляция SETUP_PLAN по нишам ──────────────────

describe("resolveNichePack: изоляция ниш", () => {
  it("Красота и уход → nail_extension", () => {
    expect(resolveNichePack({ ...NAIL_BASE, category: "Красота и уход" })).toBe(NICHE_PACKS.nail_extension);
  });

  it("монолитные работы в company_description → monolithic_works", () => {
    const card = { ...NAIL_BASE, category: "Строительство", name: "Монолитные работы" };
    const foundation = { tenant_id: "t", company_description: "Монолитные работы, заливка перекрытий" };
    expect(resolveNichePack(card, foundation as any).id).toBe("monolithic_works");
  });

  it("кладка → masonry, НЕ monolithic_works, НЕ nail_extension", () => {
    const card = { ...NAIL_BASE, category: "Строительство", name: "Кладка кирпича" };
    const foundation = { tenant_id: "t", company_description: "Кладка кирпича и газоблока" };
    const pack = resolveNichePack(card, foundation as any);
    expect(pack.id).toBe("masonry");
    expect(pack.id).not.toBe("monolithic_works");
    expect(pack.id).not.toBe("nail_extension");
  });

  it("неизвестная ниша → default fallback, не бросает ошибку", () => {
    const card = { ...NAIL_BASE, category: "IT-услуги", name: "IT-консультация" };
    const pack = resolveNichePack(card);
    expect(pack.id).toBe("default");
  });

  it("примеры кладки не содержат nail-специфичные слова и не совпадают с monolithic", () => {
    const pack = NICHE_PACKS.masonry;
    const allExamples = Object.values(pack.nodes).map((n) => n.example).join(" ");
    expect(allExamples).not.toMatch(/ноготь|гель-лак|стразы|маникюр/i);
    expect(allExamples).not.toMatch(/перекрытие|армирование|бетонасос/i);
  });

  it("примеры монолита не содержат nail-специфичные слова", () => {
    const pack = NICHE_PACKS.monolithic_works;
    const allExamples = Object.values(pack.nodes).map((n) => n.example).join(" ");
    expect(allExamples).not.toMatch(/ноготь|гель-лак|стразы|маникюр/i);
  });

  it("computeReadiness для карточки «Кладка» использует masonry-примеры, не nail", () => {
    const masonryCard = {
      ...NAIL_BASE,
      category: "Строительство",
      name: "Кладка кирпича",
    };
    const { plan } = computeReadiness(masonryCard);
    const includesNode = plan.find((n) => n.id === "includes")!;
    expect(includesNode.example).not.toMatch(/ноготь|гель|покрытие лаком/i);
    expect(includesNode.example).toMatch(/кладк|раствор|расшивк/i);
  });
});
