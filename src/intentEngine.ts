// Раздел 14, ТЗ v3.0. На Этапе 0 классификация интента — простая (длина сообщения +
// ключевые слова). Это сознательно временная реализация: при подключении реального
// ExtractionProvider (extraction/types.ts) интент будет приходить из LLM. Этот файл
// остаётся как fallback для small_talk/explain_product — их не нужно гонять через LLM
// (раздел 15.2 ТЗ — экономия на простых интентах).

export type Intent =
  | "small_talk" | "explain_product" | "business_setup" | "product_card_update"
  | "geography_update" | "scout_setup" | "avi_setup" | "correction"
  | "upload_materials" | "launch_scout" | "test_avi" | "reset" | "rate_limited";

const SMALL_TALK = /^(привет|здравствуй|как дела|hi|hello)\b/i;
const EXPLAIN = /(расскажи|что (такое|умеет)).*(aivox|продукт|систем)/i;
const RESET = /(очисти|сбрось|reset).*(настрой|состояни)/i;

export function classifyIntentLocally(message: string): { intent: Intent; confidence: number } {
  const trimmed = message.trim();
  if (SMALL_TALK.test(trimmed)) return { intent: "small_talk", confidence: 0.95 };
  if (EXPLAIN.test(trimmed)) return { intent: "explain_product", confidence: 0.9 };
  if (RESET.test(trimmed)) return { intent: "reset", confidence: 0.9 };
  // Длинное сообщение с признаками описания бизнеса/услуги — кандидат на business_setup,
  // но финальное решение остаётся за ExtractionProvider (он видит контекст диалога).
  return { intent: "business_setup", confidence: 0.4 };
}
