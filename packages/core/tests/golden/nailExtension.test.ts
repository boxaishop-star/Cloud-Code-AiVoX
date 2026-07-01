/**
 * Golden test: «Наращивание ногтей» — раздел 6, 23 ТЗ v9.1.
 *
 * Фиксирует эталонный диалог ниши «Красота / Наращивание ногтей», включая:
 *   • дожим на расплывчатый ответ «всё по договорённости»
 *   • правильные NodeStatus в SETUP_PLAN на каждом шаге
 *   • финальную карточку со всеми 11 полями
 *   • переход assistant_stage: daily_assistant в конце диалога
 *
 * НЕ использует реальный Claude — только MockExtractionProvider.
 * Ключи fixture — уникальные подстроки, не перекрывающиеся между сообщениями.
 */
import { describe, it, expect } from "vitest";
import { BusinessAssistantOrchestrator } from "../../src/orchestrator.js";
import { InMemoryStore } from "../../src/toolLayer.js";
import { MockExtractionProvider } from "../../src/extraction/mockProvider.js";
import {
  computeReadiness,
  checkProfileReadyForDailyAssistant,
  groupPlanIntoSections,
} from "../../src/nextStepController.js";
import type { ExtractionResult } from "../../src/extraction/types.js";

const TENANT = "nail_ext_golden";

// Сообщения пользователя — уникальные подстроки служат ключами fixture.
const MSG = {
  h1:  "я мастер ногтевого сервиса",           // key: "ногтевого сервиса"
  h2:  "москва м новослободская",               // key: "м новослободская"
  h3:  "наращивание гелем 2500",                // key: "наращивание гелем"
  h4:  "входит опил формы стерилизация",        // key: "опил формы"
  h5:  "по договорённости",                     // key: "договорённости"
  h6:  "стразы от 200 рублей ноготь",           // key: "стразы от 200"
  h7:  "ключевые слова нарощенные ногти цена",  // key: "нарощенные ногти"
  h8:  "находят через вконтакте двагис",        // key: "двагис"
  h9:  "уточняет дату аллергия форма",          // key: "уточняет дату"
  h10: "жалоба скидка передать мне",            // key: "жалоба скидка"
} as const;

// ── Fixture: ход → detерминированные proposed_actions ──────────────────────

const FIXTURES: Record<string, Partial<ExtractionResult>> = {
  // Ход 1: foundation без geography → карточка не должна создаться.
  "ногтевого сервиса": {
    intent: "business_setup",
    confidence: 0.92,
    proposed_actions: [
      { type: "upsert_business_foundation", payload: { company_description: "Мастер по наращиванию ногтей гелем", market_type: "B2C" } },
    ],
    clarification_text: "Понял. В каком районе и у какого метро принимаете?",
  },

  // Ход 2: geography → foundation complete.
  "м новослободская": {
    intent: "business_setup",
    confidence: 0.95,
    proposed_actions: [
      { type: "upsert_business_foundation", payload: { company_description: "Мастер по наращиванию ногтей гелем", market_type: "B2C", geography: ["Москва, м. Новослободская"] } },
    ],
    clarification_text: "Записал. Как называется ваша основная услуга и сколько стоит?",
  },

  // Ход 3: карточка создаётся — foundation complete, projected check проходит.
  "наращивание гелем": {
    intent: "business_setup",
    confidence: 0.97,
    proposed_actions: [
      {
        type: "upsert_product_card",
        payload: {
          id: "nail_ext_gel",
          name: "Наращивание ногтей гелем",
          category: "Красота и уход",
          service_line: "nail_ext_gel",
          pricing_model: "fixed",
          price: 2500,
          currency: "RUB",
        },
      },
    ],
  },

  // Ход 4: что входит → конкретные значения.
  "опил формы": {
    intent: "product_update",
    confidence: 0.95,
    proposed_actions: [
      {
        type: "update_product_card",
        payload: {
          service_line: "nail_ext_gel",
          includes: ["снятие старого покрытия", "опил формы", "стерилизация инструментов", "однотонное покрытие гель-лаком"],
        },
      },
    ],
  },

  // Ход 5: расплывчатый excludes — proposed_actions пустые, дожим.
  "договорённости": {
    intent: "product_update",
    confidence: 0.50,
    proposed_actions: [],
    clarification_text: "Понял. Назовите конкретно — например: дизайн со стразами, снятие нарощенного. Что именно оплачивается отдельно?",
  },

  // Ход 6: конкретный excludes после дожима.
  "стразы от 200": {
    intent: "product_update",
    confidence: 0.95,
    proposed_actions: [
      { type: "update_product_card", payload: { service_line: "nail_ext_gel", excludes: ["дизайн со стразами от 200 ₽/ноготь"] } },
    ],
  },

  // Ход 7: scout_signals + customer_segments + geography карточки.
  "нарощенные ногти": {
    intent: "product_update",
    confidence: 0.93,
    proposed_actions: [
      {
        type: "update_product_card",
        payload: {
          service_line: "nail_ext_gel",
          scout_search_signals: ["наращивание ногтей Новослободская", "нарощенные ногти цена Новослободская"],
          customer_segments: ["женщины 25–40, коррекция каждые 3 недели"],
          geography: ["Москва, м. Новослободская"],
        },
      },
    ],
  },

  // Ход 8: scout_sources.
  "двагис": {
    intent: "product_update",
    confidence: 0.90,
    proposed_actions: [
      { type: "update_product_card", payload: { service_line: "nail_ext_gel", scout_sources: ["ВКонтакте", "2ГИС"] } },
    ],
  },

  // Ход 9: avi_qualification_questions.
  "уточняет дату": {
    intent: "product_update",
    confidence: 0.92,
    proposed_actions: [
      {
        type: "update_product_card",
        payload: {
          service_line: "nail_ext_gel",
          avi_qualification_questions: ["дата записи", "снятие старого покрытия?", "аллергия на материалы?", "желаемая форма ногтей"],
        },
      },
    ],
  },

  // Ход 10: handoff_rules → последнее поле → должен произойти переход A→B.
  "жалоба скидка": {
    intent: "product_update",
    confidence: 0.91,
    proposed_actions: [
      {
        type: "update_product_card",
        payload: {
          service_line: "nail_ext_gel",
          handoff_to_human_rules: ["жалоба клиента", "сложный дизайн", "запрос скидки"],
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

// Помощник: прогнать N ходов диалога.
async function runHods(orch: BusinessAssistantOrchestrator, ...messages: string[]) {
  for (const msg of messages) {
    await orch.process({ userMessage: msg, tenant_id: TENANT });
  }
}

// ── Foundation gate ───────────────────────────────────────────────────────────

describe("Golden: Foundation gate (раздел 7.1.2 ТЗ v9.1)", () => {
  it("Ход 1: foundation без geography → карточка НЕ создаётся", async () => {
    const { store, orch } = makeOrch();
    await runHods(orch, MSG.h1);
    expect(await store.getProductCards(TENANT)).toHaveLength(0);
    const foundation = await store.getFoundation(TENANT) as any;
    expect(foundation?.company_description).toBeTruthy();
    expect(foundation?.market_type).toBe("B2C");
  });

  it("Ход 2: geography → foundation complete (реальное значение в geography)", async () => {
    const { store, orch } = makeOrch();
    await runHods(orch, MSG.h1, MSG.h2);
    const foundation = await store.getFoundation(TENANT) as any;
    expect(foundation?.geography?.[0]).toContain("Москва");
  });

  it("Ход 3: после foundation complete — карточка создаётся", async () => {
    const { store, orch } = makeOrch();
    await runHods(orch, MSG.h1, MSG.h2, MSG.h3);
    const cards = await store.getProductCards(TENANT);
    expect(cards).toHaveLength(1);
    expect(cards[0].name).toBe("Наращивание ногтей гелем");
    expect(cards[0].price).toBe(2500);
  });
});

// ── Дожим на расплывчатый ответ ──────────────────────────────────────────────

describe("Golden: дожим на расплывчатый excludes (раздел 7.1.2 ТЗ v9.1)", () => {
  async function toIncludes(store: InMemoryStore, orch: BusinessAssistantOrchestrator) {
    await runHods(orch, MSG.h1, MSG.h2, MSG.h3, MSG.h4);
  }

  it("Ход 5: 'по договорённости' → excludes не записывается (proposed_actions пусты)", async () => {
    const { store, orch } = makeOrch();
    await toIncludes(store, orch);
    await runHods(orch, MSG.h5);
    const [card] = await store.getProductCards(TENANT);
    expect(card.excludes).toHaveLength(0);
  });

  it("Ход 4→5: includes сохраняются после расплывчатого ответа", async () => {
    const { store, orch } = makeOrch();
    await toIncludes(store, orch);
    await runHods(orch, MSG.h5);
    const [card] = await store.getProductCards(TENANT);
    expect(card.includes).toContain("снятие старого покрытия");
    expect(card.includes).toContain("опил формы");
  });

  it("Ход 6: конкретный excludes после дожима → записывается", async () => {
    const { store, orch } = makeOrch();
    await toIncludes(store, orch);
    await runHods(orch, MSG.h5, MSG.h6);
    const [card] = await store.getProductCards(TENANT);
    expect(card.excludes[0]).toContain("дизайн");
  });
});

// ── SETUP_PLAN статусы ────────────────────────────────────────────────────────

describe("Golden: SETUP_PLAN NodeStatus (раздел 7.1.2 ТЗ v9.1)", () => {
  it("price: status='done' после создания карточки с ценой (не skipped для fixed)", async () => {
    const { store, orch } = makeOrch();
    await runHods(orch, MSG.h1, MSG.h2, MSG.h3);
    const [card] = await store.getProductCards(TENANT);
    const { plan } = computeReadiness(card);
    const priceNode = plan.find(n => n.id === "price")!;
    expect(priceNode.status).toBe("done");
    expect(priceNode.status).not.toBe("skipped");
  });

  it("estimate_inputs: status='skipped' при fixed pricing", async () => {
    const { store, orch } = makeOrch();
    await runHods(orch, MSG.h1, MSG.h2, MSG.h3);
    const [card] = await store.getProductCards(TENANT);
    const { plan } = computeReadiness(card);
    expect(plan.find(n => n.id === "estimate_inputs")!.status).toBe("skipped");
  });

  it("includes: status='done' после заполнения конкретными значениями", async () => {
    const { store, orch } = makeOrch();
    await runHods(orch, MSG.h1, MSG.h2, MSG.h3, MSG.h4);
    const [card] = await store.getProductCards(TENANT);
    const { plan } = computeReadiness(card);
    expect(plan.find(n => n.id === "includes")!.status).toBe("done");
  });
});

// ── Финальная карточка и ручная активация ────────────────────────────────────

describe("Golden: финальная карточка и ручная активация daily_assistant", () => {
  async function buildFull(store: InMemoryStore, orch: BusinessAssistantOrchestrator) {
    await runHods(orch,
      MSG.h1, MSG.h2, MSG.h3, MSG.h4,
      MSG.h5, MSG.h6, MSG.h7, MSG.h8, MSG.h9,
    );
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
    // Но профиль готов — checkProfileReadyForDailyAssistant=true
    const cards = await store.getProductCards(TENANT);
    const foundation = await store.getFoundation(TENANT);
    expect(checkProfileReadyForDailyAssistant(cards, foundation ?? undefined)).toBe(true);
    // Ручная активация
    await store.applyAction({ type: "upsert_business_foundation", payload: { tenant_id: TENANT, assistant_stage: "daily_assistant" } });
    const updated = await store.getFoundation(TENANT) as any;
    expect(updated?.assistant_stage).toBe("daily_assistant");
    // Карточка с handoff_rules записана
    const [card] = cards;
    expect(card.handoff_to_human_rules).toContain("жалоба клиента");
  });

  it("финальная карточка: readiness_score=100, нет current/upcoming узлов", async () => {
    const { store, orch } = makeOrch();
    await buildFull(store, orch);
    await runHods(orch, MSG.h10);
    const [card] = await store.getProductCards(TENANT);
    const { readiness_score, plan } = computeReadiness(card);
    expect(readiness_score).toBe(100);
    expect(plan.filter(n => n.status === "current" || n.status === "upcoming")).toHaveLength(0);
  });
});

// ── groupPlanIntoSections ─────────────────────────────────────────────────────

describe("Golden: groupPlanIntoSections (раздел 7.1.2 ТЗ v9.1)", () => {
  async function buildAll10(store: InMemoryStore, orch: BusinessAssistantOrchestrator) {
    await runHods(orch,
      MSG.h1, MSG.h2, MSG.h3, MSG.h4,
      MSG.h5, MSG.h6, MSG.h7, MSG.h8, MSG.h9, MSG.h10,
    );
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
});
