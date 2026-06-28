import type { ToolAction } from "../schemas/toolAction.js";

// Раздел 12.2, 15, ТЗ v3.0. ЭТО КЛЮЧЕВОЙ ИНТЕРФЕЙС ДЛЯ ПЕРЕХОДА ОТ ЭТАПА 0 К ЭТАПУ 1.
//
// Этап 0 (этот код) тестируется на MockExtractionProvider — детерминированном
// заглушечном провайдере с зафиксированными фикстурами, чтобы golden test не зависел
// от сети, ключей и недетерминизма реальной модели.
//
// Этап 1: команда пишет ClaudeExtractionProvider, который реализует этот же интерфейс,
// вызывая Anthropic API с tool use (раздел 13, 16 ТЗ — structured output вместо
// свободного JSON). Orchestrator (orchestrator.ts) НЕ МЕНЯЕТСЯ при этой замене —
// это и есть смысл интерфейса: подмена реализации, а не догадка о форме данных.
export interface ExtractionContext {
  tenant_id: string;
  businessFoundation: Record<string, unknown>;
  productCatalog: Record<string, unknown>[];
  activeServiceLine?: string;
  activeFactId?: string;
}

export interface ExtractionResult {
  intent: string;
  confidence: number;
  proposed_actions: ToolAction[];
  next_step?: { id: string; question: string };
}

export interface ExtractionProvider {
  extract(userMessage: string, context: ExtractionContext): Promise<ExtractionResult>;
}
