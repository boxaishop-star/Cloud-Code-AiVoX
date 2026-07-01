import { describe, it, expect } from "vitest";
import { BusinessAssistantOrchestrator } from "../src/orchestrator.js";
import { InMemoryStore } from "../src/toolLayer.js";
import { MockExtractionProvider } from "../src/extraction/mockProvider.js";

const BASE_CARD_PAYLOAD = {
  id: "svc1",
  name: "Маникюр классический",
  category: "Красота",
  service_line: "manicure_classic",
  pricing_model: "fixed" as const,
  price: 1500,
  includes: ["обработка кутикулы", "покрытие"],
  currency: "RUB",
};

// Раздел 9 ТЗ: "тест на изоляцию данных между двумя тенантами входит в обязательный
// CI до первого релиза, не 'когда-нибудь'". Это он.
describe("Изоляция данных между тенантами (раздел 9 ТЗ)", () => {
  it("ProductCard тенанта A не виден тенанту B", async () => {
    const store = new InMemoryStore();
    const extractor = new MockExtractionProvider({
      "услуга А": {
        intent: "business_setup",
        confidence: 0.9,
        proposed_actions: [
          // Foundation идёт первым — projected check разблокирует карточку в том же батче.
          { type: "upsert_business_foundation", payload: { company_description: "Услуги А", market_type: "B2C", geography: ["Москва"] } },
          { type: "upsert_product_card", payload: { id: "x", name: "Услуга А", category: "Категория А", service_line: "service_a", pricing_model: "fixed", price: 1000 } },
        ],
      },
    });
    const orch = new BusinessAssistantOrchestrator(store, extractor);

    await orch.process({ userMessage: "услуга А по цене 1000", tenant_id: "tenant_A" });

    expect(await store.getProductCards("tenant_A")).toHaveLength(1);
    expect(await store.getProductCards("tenant_B")).toHaveLength(0); // не должно утечь
  });

  it("update_product_card частично обновляет поле, остальные сохраняются", async () => {
    const store = new InMemoryStore();
    await store.applyAction({
      type: "upsert_product_card",
      payload: { ...BASE_CARD_PAYLOAD, tenant_id: "tenant_upd" },
    });

    const result = await store.applyAction({
      type: "update_product_card",
      payload: { tenant_id: "tenant_upd", service_line: "manicure_classic", price: 2000 },
    });

    expect(result.applied).toBe(true);
    const cards = await store.getProductCards("tenant_upd");
    expect(cards).toHaveLength(1);
    expect(cards[0].price).toBe(2000);
    // Поля, не переданные в payload, должны остаться нетронутыми.
    expect(cards[0].name).toBe("Маникюр классический");
    expect(cards[0].includes).toEqual(["обработка кутикулы", "покрытие"]);
  });

  it("update_product_card на несуществующую карточку возвращает понятную ошибку", async () => {
    const store = new InMemoryStore();
    const result = await store.applyAction({
      type: "update_product_card",
      payload: { tenant_id: "tenant_upd", service_line: "nonexistent", price: 999 },
    });

    expect(result.applied).toBe(false);
    expect(result.error).toMatch(/not found/i);
    expect(result.error).toContain("nonexistent");
    expect(result.error).toMatch(/upsert_product_card/);
  });

  it("BusinessFoundation одного тенанта не подмешивается в другой", async () => {
    const store = new InMemoryStore();
    await store.applyAction({ type: "upsert_business_foundation", payload: { tenant_id: "tenant_A", company_description: "Бизнес А" } });
    await store.applyAction({ type: "upsert_business_foundation", payload: { tenant_id: "tenant_B", company_description: "Бизнес Б" } });

    expect((await store.getFoundation("tenant_A"))?.company_description).toBe("Бизнес А");
    expect((await store.getFoundation("tenant_B"))?.company_description).toBe("Бизнес Б");
  });
});
