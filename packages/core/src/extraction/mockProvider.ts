import type { ExtractionContext, ExtractionProvider, ExtractionResult } from "./types.js";

// Раздел 23 ТЗ: golden test не должен зависеть от сети/ключей/недетерминизма модели.
// Этот провайдер имитирует, что вернула бы реальная LLM через tool use (раздел 13 ТЗ)
// для конкретного эталонного входного текста (раздел 20.1 ТЗ). Когда команда подключит
// ClaudeExtractionProvider на Этапе 1, этот файл и golden test НЕ переписываются —
// заменяется только провайдер, передаваемый в Orchestrator.
export class MockExtractionProvider implements ExtractionProvider {
  constructor(private fixtures: Record<string, ExtractionResult>) {}

  async extract(userMessage: string, context: ExtractionContext): Promise<ExtractionResult> {
    const key = Object.keys(this.fixtures).find((k) => userMessage.includes(k));
    if (key) {
      const fixture = this.fixtures[key];
      // tenant_id подставляется из контекста — фикстура не должна его знать заранее.
      const withTenant = fixture.proposed_actions.map((a) => ({
        ...a,
        payload: { ...(a.payload as Record<string, unknown>), tenant_id: context.tenant_id },
      })) as typeof fixture.proposed_actions;
      return { ...fixture, proposed_actions: withTenant };
    }
    return { intent: "business_setup", confidence: 0.3, proposed_actions: [] };
  }
}
