/**
 * Golden test: автогенерация каталога monolithic_works + очередь — раздел 7.1.2, 25 ТЗ v9.1.
 *
 * Проверяет три вещи:
 *   1. Одно сообщение «все виды монолитных работ» → 7 карточек за один batch.
 *   2. После batch — очередь: strip_foundation активна первой (update проходит без disambiguation).
 *   3. strip_foundation(100%) → автопереход к slab_foundation с явным анонсом.
 *
 * Тест НЕ зависит от Claude — только MockExtractionProvider.
 */
import { describe, it, expect } from "vitest";
import { BusinessAssistantOrchestrator } from "../../src/orchestrator.js";
import { InMemoryStore } from "../../src/toolLayer.js";
import { MockExtractionProvider } from "../../src/extraction/mockProvider.js";
import { computeReadiness } from "../../src/nextStepController.js";
import type { ExtractionResult } from "../../src/extraction/types.js";

const TENANT = "golden_catalog_bulk";

const FIXTURES: Record<string, ExtractionResult> = {
  // h1: foundation без geography
  "монолитными работами": {
    intent: "business_setup",
    confidence: 0.93,
    proposed_actions: [
      {
        type: "upsert_business_foundation",
        payload: {
          company_description: "Монолитные работы — заливка фундаментов и перекрытий",
          market_type: "B2C",
        },
      },
    ],
    clarification_text: "Понял. В каком городе работаете?",
  },

  // h2: geography → foundation complete
  "подмосковье": {
    intent: "business_setup",
    confidence: 0.95,
    proposed_actions: [
      {
        type: "upsert_business_foundation",
        payload: {
          company_description: "Монолитные работы — заливка фундаментов и перекрытий",
          market_type: "B2C",
          geography: ["Москва и Московская область"],
        },
      },
    ],
    clarification_text: "Записал. Расскажите об услугах.",
  },

  // h3: bulk create → 7 карточек одним batch
  "все виды монолитных": {
    intent: "business_setup",
    confidence: 0.97,
    proposed_actions: [
      { type: "upsert_product_card", payload: { id: "strip_foundation", name: "Ленточный фундамент", category: "Строительство", service_line: "strip_foundation", pricing_model: "per_m3" } },
      { type: "upsert_product_card", payload: { id: "slab_foundation",  name: "Плитный фундамент",   category: "Строительство", service_line: "slab_foundation",   pricing_model: "per_m3" } },
      { type: "upsert_product_card", payload: { id: "rostwerk",         name: "Ростверк",            category: "Строительство", service_line: "rostwerk",          pricing_model: "per_m3" } },
      { type: "upsert_product_card", payload: { id: "pathways",         name: "Дорожки",             category: "Строительство", service_line: "pathways",          pricing_model: "per_m3" } },
      { type: "upsert_product_card", payload: { id: "otmostka",         name: "Отмостка",            category: "Строительство", service_line: "otmostka",          pricing_model: "per_m3" } },
      { type: "upsert_product_card", payload: { id: "cellar",           name: "Погреб",              category: "Строительство", service_line: "cellar",            pricing_model: "per_m3" } },
      { type: "upsert_product_card", payload: { id: "armopoyar",        name: "Армопояс",            category: "Строительство", service_line: "armopoyar",         pricing_model: "per_m3" } },
    ],
    clarification_text: "Создал 7 карточек: Ленточный фундамент, Плитный фундамент, Ростверк, Дорожки, Отмостка, Погреб, Армопояс. Начнём с «Ленточный фундамент». Сколько стоит — фиксированная цена или рассчитывается по объёму?",
  },

  // h4: заполнение strip_foundation до 100% (pricing_model=per_m3 → estimate_inputs пропускается)
  "ленточный полное": {
    intent: "product_update",
    confidence: 0.95,
    proposed_actions: [
      {
        type: "update_product_card",
        payload: {
          service_line: "strip_foundation",
          price: 8000,
          currency: "RUB",
          unit: "м³",
          includes: ["армирование", "монтаж опалубки", "заливка бетона", "вибрирование бетона"],
          excludes: ["доставка бетона", "аренда бетононасоса"],
          scout_search_signals: ["ленточный фундамент Москва", "фундамент под дом цена"],
          customer_segments: ["частные застройщики ИЖС"],
          geography: ["Москва и Московская область"],
          scout_sources: ["Авито", "Яндекс.Карты"],
          avi_qualification_questions: ["объём в м³", "тип конструкции", "наличие проекта"],
          handoff_to_human_rules: ["смета от 500 000 ₽", "работа с юридическими лицами"],
        },
      },
    ],
  },
};

function makeOrch() {
  const store = new InMemoryStore();
  const orch = new BusinessAssistantOrchestrator(store, new MockExtractionProvider(FIXTURES));
  return { store, orch };
}

async function runH1H2(orch: BusinessAssistantOrchestrator) {
  await orch.process({ userMessage: "монолитными работами", tenant_id: TENANT });
  await orch.process({ userMessage: "подмосковье", tenant_id: TENANT });
}

describe("Golden: catalog bulk create monolithic_works (раздел 7.1.2, 25 ТЗ v9.1)", () => {
  it("h3 → 7 карточек созданы одним batch, ответ — clarification_text", async () => {
    const { store, orch } = makeOrch();
    await runH1H2(orch);
    const r3 = await orch.process({ userMessage: "все виды монолитных", tenant_id: TENANT });

    const cards = await store.getProductCards(TENANT);
    expect(cards).toHaveLength(7);
    expect(r3.appliedActions.filter((a) => a.action.type === "upsert_product_card")).toHaveLength(7);
    expect(cards.map((c) => c.service_line)).toEqual(
      expect.arrayContaining([
        "strip_foundation", "slab_foundation", "rostwerk",
        "pathways", "otmostka", "cellar", "armopoyar",
      ]),
    );
    expect(r3.assistantResponse).toContain("Создал 7 карточек");
    expect(r3.assistantResponse).toContain("Ленточный фундамент");
  });

  it("очередь: strip_foundation активна первой — update проходит без disambiguation", async () => {
    const { store, orch } = makeOrch();
    await runH1H2(orch);
    await orch.process({ userMessage: "все виды монолитных", tenant_id: TENANT });

    const r4 = await orch.process({ userMessage: "ленточный полное", tenant_id: TENANT });

    expect(r4.rejectedActions).toHaveLength(0);
    const updated = r4.appliedActions.find(
      (a) => a.action.type === "update_product_card" && (a.action.payload as any).service_line === "strip_foundation",
    );
    expect(updated).toBeDefined();
    expect(updated?.applied).toBe(true);
  });

  it("strip_foundation(100%) → автопереход к slab_foundation с явным анонсом", async () => {
    const { store, orch } = makeOrch();
    await runH1H2(orch);
    await orch.process({ userMessage: "все виды монолитных", tenant_id: TENANT });
    const r4 = await orch.process({ userMessage: "ленточный полное", tenant_id: TENANT });

    const cards = await store.getProductCards(TENANT);
    const strip = cards.find((c) => c.service_line === "strip_foundation")!;
    expect(computeReadiness(strip).readiness_score).toBe(100);

    expect(r4.assistantResponse).toContain("Ленточный фундамент");
    expect(r4.assistantResponse).toContain("Плитный фундамент");
    expect(r4.assistantResponse).toMatch(/Переходим|переходим/);
  });
});
