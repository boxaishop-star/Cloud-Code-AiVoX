/**
 * Раздел 6, 7.1.2 ТЗ v9.1: изоляция nail-примеров из промпта дожима на расплывчатый ответ.
 *
 * Проверяет, что buildSystemPrompt с masonry/monolithic-паком НЕ содержит
 * nail-специфичные строки в инструкциях дожима (снятие покрытия, опил формы, стерилизация).
 * Example 1/Example 2 в few-shot — намеренно мультидоменны, их не трогаем.
 */
import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "../../src/extraction/claudeProvider.js";
import { NICHE_PACKS } from "../../src/nextStepController.js";
import type { ExtractionContext } from "../../src/extraction/types.js";

function makeContext(overrides: Partial<ExtractionContext> = {}): ExtractionContext {
  return {
    tenant_id: "test",
    businessFoundation: { company_description: "Тест", market_type: "B2C", geography: ["Москва"] },
    productCatalog: [],
    assistant_stage: "profile_setup",
    missing_fields: ["includes", "excludes"],
    foundationComplete: true,
    ...overrides,
  };
}

// Слова, специфичные для nail-ниши, которые НЕ должны появляться в динамических инструкциях.
// (Example 1/Example 2 — мультидоменные примеры, их мы не проверяем.)
const NAIL_PATTERN = /снятие старого покрытия|опил формы|стерилизация инструментов|дизайн со стразами от 200/i;

describe("buildSystemPrompt: изоляция nail-примеров в инструкции дожима (раздел 6 ТЗ v9.1)", () => {
  it("masonry-пак: промпт НЕ содержит nail-специфичные строки из дожима", () => {
    const prompt = buildSystemPrompt(makeContext({ nichePack: NICHE_PACKS.masonry }));
    expect(prompt).not.toMatch(NAIL_PATTERN);
  });

  it("masonry-пак: промпт содержит masonry-пример в инструкции дожима", () => {
    const prompt = buildSystemPrompt(makeContext({ nichePack: NICHE_PACKS.masonry }));
    // includes.example для masonry — "разметка, приготовление раствора, кладка, расшивка швов"
    expect(prompt).toContain(NICHE_PACKS.masonry.nodes.includes.example);
  });

  it("monolithic_works-пак: промпт НЕ содержит nail-специфичные строки из дожима", () => {
    const prompt = buildSystemPrompt(makeContext({ nichePack: NICHE_PACKS.monolithic_works }));
    expect(prompt).not.toMatch(NAIL_PATTERN);
  });

  it("monolithic_works-пак: промпт содержит monolithic-пример в инструкции дожима", () => {
    const prompt = buildSystemPrompt(makeContext({ nichePack: NICHE_PACKS.monolithic_works }));
    expect(prompt).toContain(NICHE_PACKS.monolithic_works.nodes.includes.example);
  });

  it("nail_extension-пак: промпт содержит nail-пример (позитивная проверка)", () => {
    const prompt = buildSystemPrompt(makeContext({ nichePack: NICHE_PACKS.nail_extension }));
    expect(prompt).toContain(NICHE_PACKS.nail_extension.nodes.includes.example);
  });

  it("default-пак: промпт НЕ содержит nail-специфичные строки из дожима", () => {
    const prompt = buildSystemPrompt(makeContext({ nichePack: NICHE_PACKS.default }));
    expect(prompt).not.toMatch(NAIL_PATTERN);
  });

  it("missing[0]='excludes': использует excludes.example в инструкции дожима", () => {
    const prompt = buildSystemPrompt(makeContext({
      nichePack: NICHE_PACKS.masonry,
      missing_fields: ["excludes", "scout_signals"],
    }));
    expect(prompt).toContain(NICHE_PACKS.masonry.nodes.excludes.example);
  });

  it("missing пустой: fallback на includes.example", () => {
    const prompt = buildSystemPrompt(makeContext({
      nichePack: NICHE_PACKS.masonry,
      missing_fields: [],
    }));
    expect(prompt).toContain(NICHE_PACKS.masonry.nodes.includes.example);
  });
});
