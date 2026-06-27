import type { ToolAction } from "./schemas/toolAction.js";
import type { ProductCard } from "./schemas/productCard.js";

export interface ValidationResult {
  validActions: ToolAction[];
  errors: string[];
}

// Слова-маркеры buyer_type, которые НЕ должны встречаться в поле segment, и наоборот —
// раздел 7.1 ТЗ ("Правило segment / buyer_type"). Список заведомо неполный — это
// эвристика для Этапа 0, а не формальное доказательство; расширяется по реальным кейсам.
const BUYER_TYPE_MARKERS = ["лпр", "директор", "снабжен", "руководитель проект", "собственник дома", "принимающ"];

function looksLikeBuyerType(value: string | undefined): boolean {
  if (!value) return false;
  const lower = value.toLowerCase();
  return BUYER_TYPE_MARKERS.some((m) => lower.includes(m));
}

export function validateProposedActions(
  actions: ToolAction[],
  existingProductCards: ProductCard[],
  existingCategories: string[],
): ValidationResult {
  const errors: string[] = [];
  const validActions: ToolAction[] = [];

  for (const action of actions) {
    if (action.type === "upsert_product_card") {
      const { name, category, service_line, price } = action.payload as Record<string, unknown>;

      // Правило раздела 8.1, 2.2 ТЗ: категория не может быть услугой.
      if (typeof name === "string" && existingCategories.some((c) => c.toLowerCase() === name.toLowerCase())) {
        errors.push(`Отклонено upsert_product_card: name="${name}" совпадает с известной категорией — категория не может быть услугой (раздел 8.1 ТЗ)`);
        continue;
      }
      if (typeof category === "string" && typeof name === "string" && category.toLowerCase() === name.toLowerCase()) {
        errors.push(`Отклонено upsert_product_card: category и name совпадают ("${name}") — это признак того, что категория записывается как услуга`);
        continue;
      }

      // Запрет дублей по service_line в рамках тенанта (раздел 19 ТЗ).
      if (typeof service_line === "string") {
        const dupes = existingProductCards.filter((c) => c.service_line === service_line && c.tenant_id === (action.payload as any).tenant_id);
        if (dupes.length > 1) {
          errors.push(`Отклонено upsert_product_card: дубль service_line="${service_line}" в рамках тенанта`);
          continue;
        }
        // Запрет перезаписи точной цены более общим/нулевым значением.
        const existing = existingProductCards.find((c) => c.service_line === service_line);
        if (existing && typeof existing.price === "number" && existing.price > 0 && price === 0) {
          errors.push(`Отклонено upsert_product_card: попытка перезаписать точную цену (${existing.price}) на 0 для service_line="${service_line}" — раздел 19 ТЗ ("не перезаписывать точные данные более общими")`);
          continue;
        }
      }
    }

    if (action.type === "upsert_business_foundation") {
      const { segment, buyer_type } = action.payload as Record<string, unknown>;
      if (typeof segment === "string" && looksLikeBuyerType(segment)) {
        errors.push(`Отклонено upsert_business_foundation: segment="${segment}" похож на buyer_type — нельзя смешивать (раздел 7.1 ТЗ)`);
        continue;
      }
      if (typeof segment === "string" && typeof buyer_type === "string" && segment.trim().toLowerCase() === buyer_type.trim().toLowerCase()) {
        errors.push(`Отклонено upsert_business_foundation: segment и buyer_type идентичны ("${segment}") — вероятна ошибка копирования`);
        continue;
      }
    }

    if (action.type === "create_relationship_card") {
      const payload = action.payload as Record<string, unknown>;
      if (!payload.legal_basis || !payload.source_tier) {
        errors.push("Отклонено create_relationship_card: отсутствует legal_basis или source_tier — обязательны для каждой записи Scout (раздел 7.3.2, 19 ТЗ)");
        continue;
      }
      if (payload.source_tier === "tier2" && payload.status !== "pending_review") {
        errors.push("Отклонено create_relationship_card: источник tier2 обязан иметь статус pending_review до подтверждения человеком (раздел 7.3.1 ТЗ)");
        continue;
      }
    }

    validActions.push(action);
  }

  return { validActions, errors };
}

// Защита от "мусора" в ответе пользователю — раздел 14, 22.2 ТЗ ("[object Object]"
// в списке forbidden responses). Любое значение, прошедшее через эту функцию перед
// вставкой в текст ответа, не может превратиться в "[object Object]".
export function sanitizeForResponse(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(sanitizeForResponse).filter(Boolean).join(", ");
  // Любой непредусмотренный объект — не печатаем как есть, это и есть источник "[object Object]".
  return "";
}
