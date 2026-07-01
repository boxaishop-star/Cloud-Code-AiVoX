/**
 * Golden test: «Монолитные работы» — раздел 6, 23 ТЗ v9.1.
 *
 * Фиксирует эталонный диалог категории «Строительство / Монолитные работы»:
 *   • Foundation gate (geography обязателен)
 *   • дожим на расплывчатый ответ «по договорённости»
 *   • SETUP_PLAN использует monolithic_works-пак (НЕ nail_extension)
 *   • Проверка, что ассистент не показывает нейл-примеры
 *   • Переход assistant_stage: daily_assistant после заполнения всех полей
 *
 * Тест НЕ зависит от реального Claude — только MockExtractionProvider.
 * Ключи fixture — уникальные подстроки, не перекрывающиеся между сообщениями.
 */
import { describe, it, expect } from "vitest";
import { BusinessAssistantOrchestrator } from "../../src/orchestrator.js";
import { InMemoryStore } from "../../src/toolLayer.js";
import { MockExtractionProvider } from "../../src/extraction/mockProvider.js";
import {
  computeReadiness,
  resolveNichePack,
  NICHE_PACKS,
  checkProfileReadyForDailyAssistant,
  groupPlanIntoSections,
} from "../../src/nextStepController.js";
import type { ExtractionResult } from "../../src/extraction/types.js";

const TENANT = "monolith_golden";

const MSG = {
  h1:  "занимаюсь монолитными работами",          // key: "монолитными работами"
  h2:  "москва и московская область",              // key: "московская область"
  h3:  "монолит 8000 рублей м3",                  // key: "8000 рублей м3"
  h4:  "армирование опалубка заливка вибрирование", // key: "армирование опалубка"
  h5:  "по договорённости",                        // key: "договорённости"
  h6:  "доставка бетона аренда насоса",            // key: "аренда насоса"
  h7:  "ищут монолит под ключ перекрытие цена",    // key: "монолит под ключ"
  h8:  "авито яндекс карты форумы",               // key: "яндекс карты"
  h9:  "объём тип конструкции сроки проект",       // key: "тип конструкции"
  h10: "смета от 500 юрлицо госконтракт",          // key: "юрлицо госконтракт"
} as const;

const FIXTURES: Record<string, Partial<ExtractionResult>> = {
  // Ход 1: foundation без geography.
  "монолитными работами": {
    intent: "business_setup",
    confidence: 0.93,
    proposed_actions: [
      { type: "upsert_business_foundation", payload: { company_description: "Монолитные работы — заливка перекрытий и фундаментов", market_type: "B2C" } },
    ],
    clarification_text: "Понял. В каком городе и регионе работаете?",
  },

  // Ход 2: geography → foundation complete.
  "московская область": {
    intent: "business_setup",
    confidence: 0.95,
    proposed_actions: [
      { type: "upsert_business_foundation", payload: { company_description: "Монолитные работы — заливка перекрытий и фундаментов", market_type: "B2C", geography: ["Москва и Московская область"] } },
    ],
    clarification_text: "Записал. Расскажите об услуге — как она называется и сколько стоит?",
  },

  // Ход 3: карточка создаётся (pricing_model: per_m3).
  "8000 рублей м3": {
    intent: "business_setup",
    confidence: 0.97,
    proposed_actions: [
      {
        type: "upsert_product_card",
        payload: {
          id: "monolith_works",
          name: "Монолитные работы",
          category: "Строительство",
          service_line: "monolith_works",
          pricing_model: "per_m3",
          price: 8000,
          currency: "RUB",
          unit: "м³",
        },
      },
    ],
  },

  // Ход 4: что входит.
  "армирование опалубка": {
    intent: "product_update",
    confidence: 0.95,
    proposed_actions: [
      {
        type: "update_product_card",
        payload: {
          service_line: "monolith_works",
          includes: ["армирование", "изготовление и монтаж опалубки", "заливка бетона", "вибрирование"],
        },
      },
    ],
  },

  // Ход 5: расплывчатый excludes → дожим.
  "договорённости": {
    intent: "product_update",
    confidence: 0.50,
    proposed_actions: [],
    clarification_text: "Понял. Назовите конкретно — например: доставка бетона, аренда бетононасоса. Что именно оплачивается отдельно?",
  },

  // Ход 6: конкретный excludes.
  "аренда насоса": {
    intent: "product_update",
    confidence: 0.95,
    proposed_actions: [
      {
        type: "update_product_card",
        payload: {
          service_line: "monolith_works",
          excludes: ["доставка бетона", "аренда бетононасоса", "аренда крана"],
        },
      },
    ],
  },

  // Ход 7: scout_signals + customer_segments.
  "монолит под ключ": {
    intent: "product_update",
    confidence: 0.93,
    proposed_actions: [
      {
        type: "update_product_card",
        payload: {
          service_line: "monolith_works",
          scout_search_signals: ["монолитные работы Москва", "залить перекрытие цена", "монолит под ключ"],
          customer_segments: ["частные застройщики ИЖС", "строительные подрядчики"],
          geography: ["Москва и Московская область"],
        },
      },
    ],
  },

  // Ход 8: scout_sources.
  "яндекс карты": {
    intent: "product_update",
    confidence: 0.90,
    proposed_actions: [
      {
        type: "update_product_card",
        payload: {
          service_line: "monolith_works",
          scout_sources: ["Авито", "Яндекс.Карты", "строительные форумы"],
        },
      },
    ],
  },

  // Ход 9: avi_qualification_questions.
  "тип конструкции": {
    intent: "product_update",
    confidence: 0.92,
    proposed_actions: [
      {
        type: "update_product_card",
        payload: {
          service_line: "monolith_works",
          avi_qualification_questions: ["объём в м³", "тип конструкции (перекрытие/фундамент)", "сроки начала", "наличие проекта"],
        },
      },
    ],
  },

  // Ход 10: handoff_rules → все поля заполнены → переход A→B.
  "юрлицо госконтракт": {
    intent: "product_update",
    confidence: 0.91,
    proposed_actions: [
      {
        type: "update_product_card",
        payload: {
          service_line: "monolith_works",
          handoff_to_human_rules: ["смета от 500 000 ₽", "работа с юридическими лицами", "госконтракты"],
        },
      },
    ],
  },
};

function makeOrch() {
  const store = new InMemoryStore();
  const extractor = new MockExtractionProvider(FIXTURES as any);
  return { store, orch: new BusinessAssistantOrchestrator(store, extractor) };
}

async function runHods(orch: BusinessAssistantOrchestrator, ...messages: string[]) {
  for (const msg of messages) await orch.process({ userMessage: msg, tenant_id: TENANT });
}

// ── Изоляция ниш ─────────────────────────────────────────────────────────────

describe("Golden Construction: изоляция ниши — monolithic_works, не nail_extension", () => {
  it("resolveNichePack по category=Строительство + company_desc с монолит → monolithic_works", () => {
    const card = {
      id: "m", tenant_id: TENANT, name: "Монолитные работы", category: "Строительство",
      service_line: "monolith_works", pricing_model: "per_m3" as const, currency: "RUB",
      price_rules: [], includes: [], excludes: [], estimate_inputs: [], variants: [],
      customer_segments: [], geography: [], scout_search_signals: [], scout_sources: [],
      avi_qualification_questions: [], handoff_to_human_rules: [], evidence: [],
      source: "business_assistant" as const, created_from_conversation: true,
    };
    const foundation = { tenant_id: TENANT, company_description: "Монолитные работы — заливка перекрытий", market_type: "B2C" };
    expect(resolveNichePack(card, foundation as any).id).toBe("monolithic_works");
  });

  it("monolithic_works пак не содержит nail-примеры (ноготь/гель/стразы)", () => {
    const pack = NICHE_PACKS.monolithic_works;
    const allText = Object.values(pack.nodes).map((n) => `${n.question} ${n.example}`).join(" ");
    expect(allText).not.toMatch(/ноготь|гель-лак|стразы|маникюр|педикюр/i);
  });

  it("computeReadiness для Строительство-карточки: включает строительные примеры", async () => {
    const { store, orch } = makeOrch();
    await runHods(orch, MSG.h1, MSG.h2, MSG.h3, MSG.h4);
    const [card] = await store.getProductCards(TENANT);
    const { plan } = computeReadiness(card);
    const includesNode = plan.find((n) => n.id === "includes")!;
    // Пример должен быть из строительной ниши, не нейл-ниши
    expect(includesNode.example).not.toMatch(/ноготь|гель|покрытие лаком/i);
  });
});

// ── Foundation gate ───────────────────────────────────────────────────────────

describe("Golden Construction: Foundation gate", () => {
  it("Ход 1: foundation без geography → карточка НЕ создаётся", async () => {
    const { store, orch } = makeOrch();
    await runHods(orch, MSG.h1);
    expect(await store.getProductCards(TENANT)).toHaveLength(0);
    const foundation = await store.getFoundation(TENANT) as any;
    expect(foundation?.company_description).toContain("Монолитные");
  });

  it("Ход 2: geography → foundation complete", async () => {
    const { store, orch } = makeOrch();
    await runHods(orch, MSG.h1, MSG.h2);
    const foundation = await store.getFoundation(TENANT) as any;
    expect(foundation?.geography?.[0]).toContain("Москва");
  });

  it("Ход 3: после foundation complete — карточка создаётся с pricing_model=per_m3", async () => {
    const { store, orch } = makeOrch();
    await runHods(orch, MSG.h1, MSG.h2, MSG.h3);
    const cards = await store.getProductCards(TENANT);
    expect(cards).toHaveLength(1);
    expect(cards[0].name).toBe("Монолитные работы");
    expect(cards[0].pricing_model).toBe("per_m3");
    expect(cards[0].price).toBe(8000);
  });
});

// ── Дожим на расплывчатый ответ ──────────────────────────────────────────────

describe("Golden Construction: дожим на 'по договорённости'", () => {
  async function toIncludes(store: InMemoryStore, orch: BusinessAssistantOrchestrator) {
    await runHods(orch, MSG.h1, MSG.h2, MSG.h3, MSG.h4);
  }

  it("Ход 5: 'по договорённости' → excludes не записывается", async () => {
    const { store, orch } = makeOrch();
    await toIncludes(store, orch);
    await runHods(orch, MSG.h5);
    const [card] = await store.getProductCards(TENANT);
    expect(card.excludes).toHaveLength(0);
  });

  it("Ход 4→5: includes защищены — не стираются расплывчатым ответом", async () => {
    const { store, orch } = makeOrch();
    await toIncludes(store, orch);
    await runHods(orch, MSG.h5);
    const [card] = await store.getProductCards(TENANT);
    expect(card.includes).toContain("армирование");
  });

  it("Ход 6: конкретный excludes после дожима → записывается", async () => {
    const { store, orch } = makeOrch();
    await toIncludes(store, orch);
    await runHods(orch, MSG.h5, MSG.h6);
    const [card] = await store.getProductCards(TENANT);
    expect(card.excludes).toContain("доставка бетона");
  });
});

// ── SETUP_PLAN статусы (monolithic_works pack) ────────────────────────────────

describe("Golden Construction: SETUP_PLAN NodeStatus", () => {
  it("per_m3: price=done после заполнения (не skipped — per_m3 ≠ custom)", async () => {
    const { store, orch } = makeOrch();
    await runHods(orch, MSG.h1, MSG.h2, MSG.h3);
    const [card] = await store.getProductCards(TENANT);
    const { plan } = computeReadiness(card);
    expect(plan.find((n) => n.id === "price")!.status).toBe("done");
    expect(plan.find((n) => n.id === "price")!.status).not.toBe("skipped");
  });

  it("estimate_inputs=skipped для per_m3 (не custom)", async () => {
    const { store, orch } = makeOrch();
    await runHods(orch, MSG.h1, MSG.h2, MSG.h3);
    const [card] = await store.getProductCards(TENANT);
    const { plan } = computeReadiness(card);
    expect(plan.find((n) => n.id === "estimate_inputs")!.status).toBe("skipped");
  });

  it("includes=done после реальных строительных значений", async () => {
    const { store, orch } = makeOrch();
    await runHods(orch, MSG.h1, MSG.h2, MSG.h3, MSG.h4);
    const [card] = await store.getProductCards(TENANT);
    const { plan } = computeReadiness(card);
    expect(plan.find((n) => n.id === "includes")!.status).toBe("done");
  });
});

// ── Финальная карточка и ручная активация ────────────────────────────────────

describe("Golden Construction: финал и ручная активация daily_assistant", () => {
  async function buildFull(store: InMemoryStore, orch: BusinessAssistantOrchestrator) {
    await runHods(orch, MSG.h1, MSG.h2, MSG.h3, MSG.h4, MSG.h5, MSG.h6, MSG.h7, MSG.h8, MSG.h9);
  }

  it("после 9 ходов — 7+ полей заполнены, readiness_score > 80", async () => {
    const { store, orch } = makeOrch();
    await buildFull(store, orch);
    const [card] = await store.getProductCards(TENANT);
    const { readiness_score } = computeReadiness(card);
    expect(card.includes.length).toBeGreaterThan(0);
    expect(card.excludes.length).toBeGreaterThan(0);
    expect(card.scout_search_signals.length).toBeGreaterThan(0);
    expect(card.customer_segments.length).toBeGreaterThan(0);
    expect(card.geography.length).toBeGreaterThan(0);
    expect(card.scout_sources.length).toBeGreaterThan(0);
    expect(card.avi_qualification_questions.length).toBeGreaterThan(0);
    expect(readiness_score).toBeGreaterThan(80);
  });

  it("Ход 10: handoff_rules → стадия profile_setup, checkProfileReadyForDailyAssistant=true, ручная активация срабатывает", async () => {
    const { store, orch } = makeOrch();
    await buildFull(store, orch);
    const result = await orch.process({ userMessage: MSG.h10, tenant_id: TENANT });
    // Без авто-перехода orch возвращает profile_setup
    expect(result.assistant_stage).toBe("profile_setup");
    // Профиль готов
    const cards = await store.getProductCards(TENANT);
    const foundation = await store.getFoundation(TENANT);
    expect(checkProfileReadyForDailyAssistant(cards, foundation ?? undefined)).toBe(true);
    // Ручная активация
    await store.applyAction({ type: "upsert_business_foundation", payload: { tenant_id: TENANT, assistant_stage: "daily_assistant" } });
    const updated = await store.getFoundation(TENANT) as any;
    expect(updated?.assistant_stage).toBe("daily_assistant");
    const [card] = cards;
    expect(card.handoff_to_human_rules).toContain("смета от 500 000 ₽");
  });

  it("финальная карточка: readiness_score=100, нет current/upcoming узлов", async () => {
    const { store, orch } = makeOrch();
    await buildFull(store, orch);
    await runHods(orch, MSG.h10);
    const [card] = await store.getProductCards(TENANT);
    const { readiness_score, plan } = computeReadiness(card);
    expect(readiness_score).toBe(100);
    expect(plan.filter((n) => n.status === "current" || n.status === "upcoming")).toHaveLength(0);
  });
});

// ── groupPlanIntoSections ─────────────────────────────────────────────────────

describe("Golden Construction: groupPlanIntoSections (раздел 7.1.2 ТЗ v9.1)", () => {
  async function buildAll10(store: InMemoryStore, orch: BusinessAssistantOrchestrator) {
    await runHods(orch, MSG.h1, MSG.h2, MSG.h3, MSG.h4, MSG.h5, MSG.h6, MSG.h7, MSG.h8, MSG.h9, MSG.h10);
  }

  it("секция avi не дублируется и содержит оба nodeId", async () => {
    const { store, orch } = makeOrch();
    await buildAll10(store, orch);
    const [card] = await store.getProductCards(TENANT);
    const { plan } = computeReadiness(card);
    const sections = groupPlanIntoSections(plan);
    const aviSections = sections.filter((s) => s.id === "avi");
    expect(aviSections).toHaveLength(1);
    expect(aviSections[0].nodeIds).toContain("avi_questions");
    expect(aviSections[0].nodeIds).toContain("handoff_rules");
  });

  it("launch=upcoming когда readyToLaunch=false", async () => {
    const { store, orch } = makeOrch();
    await runHods(orch, MSG.h1, MSG.h2, MSG.h3);
    const [card] = await store.getProductCards(TENANT);
    const { plan } = computeReadiness(card);
    const sections = groupPlanIntoSections(plan, { readyToLaunch: false, stage: "profile_setup" });
    expect(sections.find((s) => s.id === "launch")!.status).toBe("upcoming");
  });

  it("launch=current когда readyToLaunch=true и stage=profile_setup", async () => {
    const { store, orch } = makeOrch();
    await buildAll10(store, orch);
    const cards = await store.getProductCards(TENANT);
    const foundation = await store.getFoundation(TENANT);
    const { plan } = computeReadiness(cards[0]);
    const ready = checkProfileReadyForDailyAssistant(cards, foundation ?? undefined);
    const sections = groupPlanIntoSections(plan, { readyToLaunch: ready, stage: "profile_setup" });
    expect(sections.find((s) => s.id === "launch")!.status).toBe("current");
  });

  it("foundationExtras: адрес=upcoming, телефон=upcoming, режим работы=upcoming без данных", async () => {
    const { store, orch } = makeOrch();
    await runHods(orch, MSG.h1, MSG.h2, MSG.h3);
    const [card] = await store.getProductCards(TENANT);
    const foundation = await store.getFoundation(TENANT);
    const { plan } = computeReadiness(card);
    const sections = groupPlanIntoSections(plan, { foundation: foundation ?? undefined });
    const businessSection = sections.find((s) => s.id === "business")!;
    expect(businessSection.foundationExtras).toBeDefined();
    expect(businessSection.foundationExtras!.find((e) => e.id === "address")!.status).toBe("upcoming");
    expect(businessSection.foundationExtras!.find((e) => e.id === "phone")!.status).toBe("upcoming");
    expect(businessSection.foundationExtras!.find((e) => e.id === "working_hours")!.status).toBe("upcoming");
  });
});

// ── Business Foundation: company_name ─────────────────────────────────────────

describe("Golden Construction: company_name в Business Foundation (раздел 10 ТЗ v9.1)", () => {
  it("сообщение с названием компании → foundation.company_name сохранён", async () => {
    const COMPANY_FIXTURE: Record<string, Partial<ExtractionResult>> = {
      "СтройМонолит": {
        intent: "business_setup",
        confidence: 0.95,
        proposed_actions: [
          {
            type: "upsert_business_foundation",
            payload: {
              company_name: "СтройМонолит",
              company_description: "Монолитные работы — заливка перекрытий и фундаментов",
              market_type: "B2C",
            },
          },
        ],
        clarification_text: "Понял. В каком городе работает СтройМонолит?",
      },
    };

    const store = new InMemoryStore();
    const extractor = new MockExtractionProvider(COMPANY_FIXTURE as any);
    const orch = new BusinessAssistantOrchestrator(store, extractor);

    await orch.process({ userMessage: "Мы — СтройМонолит, занимаемся монолитными работами", tenant_id: TENANT });
    const foundation = await store.getFoundation(TENANT) as any;
    expect(foundation?.company_name).toBe("СтройМонолит");
    expect(foundation?.company_description).toContain("Монолитные");
  });

  it("foundationExtras: working_hours=done когда поле заполнено через upsert", async () => {
    const store = new InMemoryStore();
    await store.applyAction({
      type: "upsert_business_foundation",
      payload: {
        tenant_id: TENANT,
        company_description: "Монолитные работы",
        market_type: "B2C",
        geography: ["Москва"],
        working_hours: "пн-пт 8:00–18:00",
        address: "Москва, ул. Строителей, 1",
        phone: "+7 999 000-00-00",
      },
    });
    const foundation = await store.getFoundation(TENANT);
    // Любая карточка для groupPlanIntoSections
    const plan: import("../../src/nextStepController.js").SetupPlanItem[] = [];
    const sections = groupPlanIntoSections(plan, { foundation: foundation ?? undefined });
    const businessSection = sections.find((s) => s.id === "business")!;
    expect(businessSection.foundationExtras!.find((e) => e.id === "working_hours")!.status).toBe("done");
    expect(businessSection.foundationExtras!.find((e) => e.id === "address")!.status).toBe("done");
    expect(businessSection.foundationExtras!.find((e) => e.id === "phone")!.status).toBe("done");
  });
});
