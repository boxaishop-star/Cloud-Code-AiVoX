#!/usr/bin/env tsx
/**
 * Создаёт BusinessFoundation + ProductCard для tenant scout_avi_demo.
 * Идемпотентен — повторный запуск перезаписывает данные без ошибок (upsert).
 * Не трогает никакие другие тенанты; тесты его не используют.
 *
 * Запуск из корня монорепо:
 *   npx tsx scripts/dev/seed-demo-tenant.ts
 */
import { randomUUID } from 'crypto';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config as loadEnv } from 'dotenv';

const __scriptDir = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__scriptDir, '../../.env') });

import { createPrismaClient } from '../../packages/core/src/db/client.js';
import { PostgresStore } from '../../packages/core/src/db/postgresStore.js';

const TENANT_ID = 'scout_avi_demo';

async function main() {
  const client = createPrismaClient();
  const store = new PostgresStore(client);

  // ── BusinessFoundation ────────────────────────────────────────────────────
  const foundationResult = await store.applyAction({
    type: 'upsert_business_foundation',
    payload: {
      tenant_id: TENANT_ID,
      company_description:
        'Бьюти-студия «Лак & Co» — маникюр и педикюр в Москве (Раменки, м. Кунцевская). ' +
        'Принимаем без ожидания по предварительной записи. Работаем с 09:00 до 21:00 без выходных.',
      business_type: 'beauty_studio',
      market_type: 'B2C',
      industry: 'Красота и уход',
      segment: 'маникюр, педикюр, наращивание ногтей',
      icp: 'женщины 20-45 лет, живущие или работающие рядом с м. Кунцевская',
      buyer_type: 'физическое лицо',
      offer: 'Маникюр с покрытием от 1 500 руб., педикюр от 2 200 руб. Быстро и без очереди.',
      geography: ['Москва', 'Раменки', 'Кунцевская'],
      scout_geography: ['Москва'],
      scout_targets:
        'Женщины в Telegram/VK, которые ищут мастера маникюра в Москве, хотят записаться или спрашивают рекомендации',
      search_goal: 'Привлечь новых клиентов на маникюр и педикюр через мессенджеры и соцсети',
      product_summary:
        'Классический и аппаратный маникюр, гель-лак, наращивание ногтей, педикюр. Цены фиксированные.',
    },
  });

  if (!foundationResult.applied) {
    console.error('Ошибка BusinessFoundation:', foundationResult.error);
    await client.$disconnect();
    process.exit(1);
  }
  console.log('✓ BusinessFoundation upserted для', TENANT_ID);

  // ── ProductCard: маникюр с гель-лаком ────────────────────────────────────
  const cardResult = await store.applyAction({
    type: 'upsert_product_card',
    payload: {
      id: randomUUID(),
      tenant_id: TENANT_ID,
      name: 'Маникюр с покрытием гель-лак',
      category: 'Уход за ногтями',
      service_line: 'manicure_gel',
      description:
        'Классический маникюр (обрезной или европейский) с нанесением гель-лакового покрытия. ' +
        'Держится до 3–4 недель. Включает снятие старого покрытия.',
      pricing_model: 'fixed',
      price: 1800,
      currency: 'RUB',
      price_rules: [
        'Снятие чужого покрытия +300 руб.',
        'Дизайн (стразы, градиент, рисунок) от +200 руб. за ноготь',
        'Укрепление ногтей базой +200 руб.',
      ],
      includes: [
        'Снятие старого гель-лака студии',
        'Обрезной или европейский маникюр',
        'Покрытие гель-лаком (1 цвет)',
        'Финишное покрытие',
      ],
      excludes: ['Дизайн', 'Наращивание', 'Парафинотерапия'],
      variants: ['Классический маникюр без покрытия — 900 руб.', 'Наращивание на типсы — 2 500 руб.'],
      customer_segments: ['женщины 20-45 лет', 'офисные сотрудницы', 'молодые мамы'],
      geography: ['Москва', 'Раменки', 'Кунцевская'],
      scout_search_signals: [
        'маникюр Москва',
        'маникюр Кунцевская',
        'хочу сделать маникюр',
        'ищу мастера маникюра',
        'запись на маникюр',
        'гель-лак',
        'ногти',
      ],
      scout_sources: ['Telegram-группы', 'VK-сообщества', 'городские чаты'],
      avi_qualification_questions: [
        'Вы уже делали гель-лак раньше или первый раз?',
        'Вам нужно снять чужое покрытие?',
        'Есть предпочтения по цвету или хотите дизайн?',
      ],
      handoff_to_human_rules: [
        'Клиент хочет сложный дизайн (аэрография, 3D) — передать администратору',
        'Есть кожные проблемы или аллергия — передать мастеру для консультации',
      ],
      readiness_score: 90,
      missing_fields: [],
      source: 'seed_script',
      created_from_conversation: false,
    },
  });

  if (!cardResult.applied) {
    console.error('Ошибка ProductCard:', cardResult.error);
    await client.$disconnect();
    process.exit(1);
  }
  console.log('✓ ProductCard "Маникюр с гель-лаком" upserted для', TENANT_ID);

  // ── Верификация: читаем обратно из БД ─────────────────────────────────────
  const foundation = await store.getFoundation(TENANT_ID);
  const cards = await store.getProductCards(TENANT_ID);

  console.log('\n── Результат в БД ──────────────────────────────────');
  console.log('BusinessFoundation:');
  console.log('  company_description:', foundation?.company_description?.slice(0, 70) + '...');
  console.log('  geography:', foundation?.geography);
  console.log('  market_type:', foundation?.market_type);
  console.log(`ProductCards (${cards.length}):`)
  for (const c of cards) {
    console.log(`  [${c.service_line}] ${c.name} — ${c.price} ${c.currency}`);
    console.log('    includes:', c.includes);
  }
  console.log('────────────────────────────────────────────────────\n');

  await client.$disconnect();
}

main().catch((err) => {
  console.error('Критическая ошибка:', err);
  process.exit(1);
});
