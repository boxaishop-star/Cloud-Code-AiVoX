import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../src/toolLayer.js";
import type { AdminDataStore } from "../src/store.js";

describe("getAllTenants — InMemoryStore (раздел 9.1 ТЗ)", () => {
  function asAdmin(store: InMemoryStore): AdminDataStore {
    return store as unknown as AdminDataStore;
  }

  it("возвращает пустой список при отсутствии фундаментов", async () => {
    const store = new InMemoryStore();
    expect(await asAdmin(store).getAllTenants()).toEqual([]);
  });

  it("возвращает все tenant_id без дублей", async () => {
    const store = new InMemoryStore();
    for (const tid of ["tenant_A", "tenant_B", "tenant_C"]) {
      await store.applyAction({
        type: "upsert_business_foundation",
        payload: { tenant_id: tid, company_description: `Бизнес ${tid}` },
      });
    }

    const tenants = await asAdmin(store).getAllTenants();
    expect(tenants).toHaveLength(3);
    expect(tenants).toContain("tenant_A");
    expect(tenants).toContain("tenant_B");
    expect(tenants).toContain("tenant_C");
  });

  it("повторный upsert не создаёт дубль", async () => {
    const store = new InMemoryStore();
    await store.applyAction({
      type: "upsert_business_foundation",
      payload: { tenant_id: "dup_tenant", company_description: "v1" },
    });
    await store.applyAction({
      type: "upsert_business_foundation",
      payload: { tenant_id: "dup_tenant", company_description: "v2" },
    });

    const tenants = await asAdmin(store).getAllTenants();
    expect(tenants.filter((t) => t === "dup_tenant")).toHaveLength(1);
  });

  it("ProductCard-тенант без Foundation не попадает в список", async () => {
    const store = new InMemoryStore();
    await store.applyAction({
      type: "upsert_business_foundation",
      payload: { tenant_id: "has_foundation" },
    });
    // tenant "only_card" создаёт карточку, но не Foundation
    await store.applyAction({
      type: "upsert_product_card",
      payload: {
        tenant_id: "only_card",
        id: "p1",
        name: "Услуга",
        category: "Категория",
        service_line: "svc",
        pricing_model: "fixed",
      },
    });

    const tenants = await asAdmin(store).getAllTenants();
    expect(tenants).toContain("has_foundation");
    expect(tenants).not.toContain("only_card");
  });
});
