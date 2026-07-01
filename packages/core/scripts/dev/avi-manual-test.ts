#!/usr/bin/env tsx
/**
 * Интерактивный REPL для ручного тестирования ClaudeAviConversationEngine.
 * Раздел 7.2 ТЗ v9.1 — только для разработки, не для production.
 *
 * Запуск из packages/core/:
 *   npm run avi:test                          # ниша по умолчанию: monolithic_works
 *   npm run avi:test -- --niche nail_extension
 *   npm run avi:test -- --niche masonry
 */

import { createInterface } from 'readline';
import { config as loadEnv } from 'dotenv';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

// .env из корня монорепо (4 уровня выше packages/core/scripts/dev/)
const __scriptDir = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__scriptDir, '../../../../.env') });

import { ClaudeAviConversationEngine } from '../../src/avi/conversationEngine.js';
import type { ProductCard } from '../../src/schemas/productCard.js';
import type { BusinessFoundation } from '../../src/schemas/businessFoundation.js';

// ── Фиктивные карточки — взяты из эталонных диалогов golden-тестов ───────────

type NicheKey = 'masonry' | 'monolithic_works' | 'nail_extension';

const FIXTURES: Record<NicheKey, { card: ProductCard; foundation: BusinessFoundation }> = {

  // Из nailExtension.test.ts — финальная карточка после 10 ходов
  nail_extension: {
    card: {
      id: 'nail_ext_gel',
      tenant_id: 'avi_repl',
      name: 'Наращивание ногтей гелем',
      category: 'Красота и уход',
      service_line: 'nail_ext_gel',
      pricing_model: 'fixed',
      price: 2500,
      currency: 'RUB',
      price_rules: [],
      includes: ['снятие старого покрытия', 'опил формы', 'стерилизация инструментов', 'однотонное покрытие гель-лаком'],
      excludes: ['дизайн со стразами от 200 ₽/ноготь'],
      estimate_inputs: [],
      variants: [],
      customer_segments: ['женщины 25–40, коррекция каждые 3 недели'],
      geography: ['Москва, м. Новослободская'],
      scout_search_signals: ['наращивание ногтей Новослободская', 'нарощенные ногти цена Новослободская'],
      scout_sources: ['ВКонтакте', '2ГИС'],
      avi_qualification_questions: ['дата записи', 'снятие старого покрытия?', 'аллергия на материалы?', 'желаемая форма ногтей'],
      handoff_to_human_rules: ['жалоба клиента', 'сложный дизайн', 'запрос скидки'],
      evidence: [],
      source: 'business_assistant',
      created_from_conversation: true,
    },
    foundation: {
      tenant_id: 'avi_repl',
      company_description: 'Мастер по наращиванию ногтей гелем',
      market_type: 'B2C',
      geography: ['Москва, м. Новослободская'],
    },
  },

  // Из construction.test.ts — финальная карточка после 10 ходов (реальная ниша аккаунта Авито)
  monolithic_works: {
    card: {
      id: 'monolith_works',
      tenant_id: 'avi_repl',
      name: 'Монолитные работы',
      category: 'Строительство',
      service_line: 'monolith_works',
      pricing_model: 'per_m3',
      price: 8000,
      currency: 'RUB',
      unit: 'м³',
      price_rules: [],
      includes: ['армирование', 'изготовление и монтаж опалубки', 'заливка бетона', 'вибрирование'],
      excludes: ['доставка бетона', 'аренда бетононасоса', 'аренда крана'],
      estimate_inputs: ['объём конструкции (м³)', 'тип (перекрытие/колонна/фундамент)', 'класс бетона'],
      variants: [],
      customer_segments: ['частные застройщики ИЖС', 'строительные подрядчики'],
      geography: ['Москва и Московская область'],
      scout_search_signals: ['монолитные работы Москва', 'залить перекрытие цена', 'монолит под ключ'],
      scout_sources: ['Авито', 'Яндекс.Карты', 'строительные форумы'],
      avi_qualification_questions: ['объём в м³', 'тип конструкции (перекрытие/фундамент)', 'сроки начала', 'наличие проекта'],
      handoff_to_human_rules: ['смета от 500 000 ₽', 'работа с юридическими лицами', 'госконтракты'],
      evidence: [],
      source: 'business_assistant',
      created_from_conversation: true,
    },
    foundation: {
      tenant_id: 'avi_repl',
      company_description: 'Монолитные работы — заливка перекрытий и фундаментов',
      market_type: 'B2C',
      geography: ['Москва и Московская область'],
    },
  },

  // Из NICHE_PACKS.masonry в nextStepController.ts — синтетическая карточка
  masonry: {
    card: {
      id: 'masonry',
      tenant_id: 'avi_repl',
      name: 'Кладка кирпича и газоблока',
      category: 'Строительство',
      service_line: 'masonry',
      pricing_model: 'from_price',
      price: 1500,
      currency: 'RUB',
      unit: 'м²',
      price_rules: [],
      includes: ['разметка', 'приготовление раствора', 'кладка', 'расшивка швов'],
      excludes: ['кирпич и раствор (материалы заказчика)', 'подъём выше 2-го этажа'],
      estimate_inputs: ['площадь стен (м²)', 'толщина кладки (1 кирпич / 0.5 кирпича)', 'тип материала'],
      variants: [],
      customer_segments: ['частники ИЖС', 'строительные подрядчики', 'прорабы'],
      geography: ['Москва и Московская область'],
      scout_search_signals: ['кладка кирпича Москва', 'кирпичная кладка цена за м²'],
      scout_sources: ['Авито', '2ГИС', 'строительные чаты'],
      avi_qualification_questions: ['объём (м²)', 'тип и толщина кладки', 'материал — свой или заказчика?'],
      handoff_to_human_rules: ['смета от 300 000 ₽', 'нестандартный кирпич', 'юридическое лицо'],
      evidence: [],
      source: 'business_assistant',
      created_from_conversation: true,
    },
    foundation: {
      tenant_id: 'avi_repl',
      company_description: 'Мастер по кладке кирпича и газоблока',
      market_type: 'B2C',
      geography: ['Москва и Московская область'],
    },
  },
};

// ── Парсинг аргументов ────────────────────────────────────────────────────────

function parseNiche(): NicheKey {
  const idx = process.argv.indexOf('--niche');
  if (idx === -1) return 'monolithic_works';
  const val = process.argv[idx + 1];
  if (!val || !(val in FIXTURES)) {
    const valid = Object.keys(FIXTURES).join(' | ');
    console.error(`Неизвестная ниша: "${val ?? ''}". Допустимые: ${valid}`);
    process.exit(1);
  }
  return val as NicheKey;
}

// ── REPL ──────────────────────────────────────────────────────────────────────

async function main() {
  const niche = parseNiche();
  const { card, foundation } = FIXTURES[niche];
  const engine = new ClaudeAviConversationEngine();

  const history: { role: 'client' | 'avi'; text: string }[] = [];

  const priceLabel = card.price != null
    ? `${card.price} ${card.currency}${card.unit ? '/' + card.unit : ''}`
    : 'рассчитывается индивидуально';

  console.log(`\n━━━ Avi REPL — ниша: ${niche} ━━━`);
  console.log(`Карточка : «${card.name}» | ${priceLabel}`);
  console.log(`Handoff  : ${card.handoff_to_human_rules.join(', ')}`);
  console.log('exit / quit — завершить сессию\n');

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  const ask = () => {
    rl.question('Клиент: ', async (raw) => {
      const line = raw.trim();

      if (!line) { ask(); return; }

      if (line.toLowerCase() === 'exit' || line.toLowerCase() === 'quit') {
        console.log('\nСессия завершена.');
        rl.close();
        return;
      }

      try {
        const result = await engine.respond(line, history, card, foundation);

        history.push({ role: 'client', text: line });
        history.push({ role: 'avi', text: result.message });

        console.log(`\nAvi: ${result.message}`);
        console.log(`[handoffTriggered: ${result.handoffTriggered}, loggedFacts: ${result.loggedFacts.length}]`);

        if (result.handoffTriggered && result.handoffReason) {
          console.log(`[handoffReason: ${result.handoffReason}]`);
        }

        for (const f of result.loggedFacts) {
          console.log(`  fact: ${f.field} = ${f.value}  (cardVersion: ${f.productCardVersion})`);
        }

        console.log('');
      } catch (err) {
        console.error('Ошибка:', err instanceof Error ? err.message : String(err));
        console.log('');
      }

      ask();
    });
  };

  ask();
}

main();
