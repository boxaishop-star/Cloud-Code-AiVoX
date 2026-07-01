/**
 * Раздел 7.1.2 ТЗ v9.1 — фильтр расплывчатых ответов для array-полей карточки.
 * Расплывчатый-только ответ не считается заполненным полем — модель дожимает конкретику.
 */

export const VAGUE_PHRASES = new Set([
  "по договоренности",
  "по договорённости",
  "как получится",
  "по ситуации",
  "все включено",
  "всё включено",
  "разное",
  "по-разному",
  "не знаю",
  "как обычно",
  "стандартно",
  "все как у всех",
  "всё как у всех",
  "смотря как",
  "зависит",
  "в зависимости",
  "обсуждается",
  "обсудим",
  "на усмотрение",
]);

/** Нормализует строку для сравнения с VAGUE_PHRASES. */
function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Возвращает true если строка — расплывчатая фраза без конкретики.
 * Проверяет точное совпадение и вхождение (короткие фразы-ответы типа "зависит").
 */
export function isVague(s: string): boolean {
  const n = normalize(s);
  if (VAGUE_PHRASES.has(n)) return true;
  // Короткие ответы (≤2 слов), целиком состоящие из расплывчатой фразы
  for (const phrase of VAGUE_PHRASES) {
    if (n === phrase || (phrase.split(" ").length === 1 && n.includes(phrase))) return true;
  }
  return false;
}

/**
 * Возвращает true если массив непустой, но ВСЕ его элементы — расплывчатые фразы.
 * undefined/пустой массив → false (поле считается незаполненным по другой причине).
 */
export function isVagueOnly(arr: string[] | undefined | null): boolean {
  if (!Array.isArray(arr) || arr.length === 0) return false;
  return arr.every(isVague);
}
