import { describe, it, expect } from "vitest";
import { BusinessAssistantOrchestrator } from "../src/orchestrator.js";
import { InMemoryStore } from "../src/toolLayer.js";
import { MockExtractionProvider } from "../src/extraction/mockProvider.js";

// Раздел 9 ТЗ: "тест на изоляцию данных между двумя тенантами входит в обязательный
// CI до первого релиза, не 'когда-нибудь'". Это он.
describe("Изоляция данных между тенантами (раздел 9 ТЗ)", () => {
  it("ProductCard тенанта A не виден тенанту B", async () => {
    const store = new InMemoryStore();
    const extractor = new MockExtractionProvider({
      "услуга А": {
        intent: "business_setup",
        confidence: 0.9,
        proposed_actions: [{
          type: "upsert_product_card",
          payload: { id: "x", name: "Услуга А", category: "Категория А", service_line: "service_a", pricing_model: "fixed", price: 1000 },
        }],
      },
    });
    const orch = new BusinessAssistantOrchestrator(store, extractor);

    await orch.process({ userMessage: "услуга А по цене 1000", tenant_id: "tenant_A" });

    expect(await store.getProductCards("tenant_A")).toHaveLength(1);
    expect(await store.getProductCards("tenant_B")).toHaveLength(0); // не должно утечь
  });

  it("BusinessFoundation одного тенанта не подмешивается в другой", async () => {
    const store = new InMemoryStore();
    await store.applyAction({ type: "upsert_business_foundation", payload: { tenant_id: "tenant_A", company_description: "Бизнес А" } });
    await store.applyAction({ type: "upsert_business_foundation", payload: { tenant_id: "tenant_B", company_description: "Бизнес Б" } });

    expect((await store.getFoundation("tenant_A"))?.company_description).toBe("Бизнес А");
    expect((await store.getFoundation("tenant_B"))?.company_description).toBe("Бизнес Б");
  });
});
