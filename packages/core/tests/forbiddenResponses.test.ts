import { describe, it, expect } from "vitest";
import { sanitizeForResponse } from "../src/validation.js";

// Раздел 22.2 ТЗ — список запрещённых ответов. На Этапе 0 мы не можем протестировать
// "Отлично. Начнём с услуг" как буквальную строку (это будет делать реальная LLM на
// Этапе 1), но мы можем и обязаны гарантировать, что "[object Object]" архитектурно
// невозможен — это и проверяет этот тест.
describe("Forbidden responses (раздел 22.2 ТЗ)", () => {
  it("sanitizeForResponse никогда не возвращает [object Object]", () => {
    const weirdInputs: unknown[] = [
      { foo: "bar" },
      [{ a: 1 }, { b: 2 }],
      new Date(),
      undefined,
      null,
      Symbol("x"),
    ];
    for (const input of weirdInputs) {
      const result = sanitizeForResponse(input);
      expect(result).not.toContain("[object Object]");
      expect(result).not.toContain("object Object");
    }
  });

  it("массивы с примитивами рендерятся как читаемый список, а не как [object Object]", () => {
    const result = sanitizeForResponse(["подготовка участка", "армирование"]);
    expect(result).toBe("подготовка участка, армирование");
  });
});
