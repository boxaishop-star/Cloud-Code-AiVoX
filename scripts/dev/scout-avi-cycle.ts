#!/usr/bin/env tsx
/**
 * Scout→Avi сквозной цикл — интерактивный CLI для ручной проверки качества черновиков.
 * Раздел 7.5 ТЗ: НЕ является настоящим Outreach Workflow; не отправляет сообщения автоматически.
 *
 * Запуск из корня монорепо:
 *   npx tsx scripts/dev/scout-avi-cycle.ts
 */
import { createInterface } from 'readline';
import { randomUUID } from 'crypto';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config as loadEnv } from 'dotenv';

// Загружаем .env из корня монорепо (на 2 уровня выше scripts/dev/)
const __scriptDir = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__scriptDir, '../../.env') });

// Относительные импорты из packages/core/src — tsx разрешает .js → .ts
import { createPrismaClient } from '../../packages/core/src/db/client.js';
import { PostgresStore } from '../../packages/core/src/db/postgresStore.js';
import { ClaudeDraftProvider } from '../../packages/core/src/avi/draftProvider.js';
import type { RelationshipCard } from '../../packages/core/src/schemas/relationshipCard.js';
import type { ProductCard } from '../../packages/core/src/schemas/productCard.js';

// ── readline helper ───────────────────────────────────────────────────────────

const rl = createInterface({ input: process.stdin, output: process.stdout });

function ask(prompt: string): Promise<string> {
  return new Promise((resolve) => rl.question(prompt, (a) => resolve(a.trim())));
}

// ── detected_need extraction (эвристика — LLM здесь не нужен) ────────────────

function extractDetectedNeed(rawText: string): string {
  return rawText.slice(0, 300).trim();
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n=== Scout→Avi цикл (ручная проверка) ===\n');

  // 1. Tenant
  const tenantRaw = await ask('tenant_id [manual_test_1]: ');
  const tenantId = tenantRaw || 'manual_test_1';

  // 2. Исходное сообщение (имитация того, что Scout нашёл в канале)
  console.log('\nВставьте текст сообщения, как будто нашли его в канале.');
  console.log('(пустая строка = конец ввода)\n');
  const lines: string[] = [];
  while (true) {
    const line = await ask('> ');
    if (line === '') break;
    lines.push(line);
  }
  const rawMessage = lines.join('\n').trim();
  if (!rawMessage) {
    console.log('Текст пустой, выход.');
    rl.close();
    return;
  }

  // 3. Создаём RelationshipCard
  const client = createPrismaClient();
  const store = new PostgresStore(client);
  const cardId = randomUUID();

  const cardPayload: RelationshipCard = {
    id: cardId,
    tenant_id: tenantId,
    type: 'lead',
    source_tier: 'manual',
    legal_basis: 'добавлено пользователем вручную',
    status: 'new',
    detected_need: extractDetectedNeed(rawMessage),
    source: 'cli_manual_input',
    do_not_contact: false,
    confidence_score: null,
    handoff_required: false,
  };

  const createResult = await store.applyAction({
    type: 'create_relationship_card',
    payload: cardPayload,
  });

  if (!createResult.applied) {
    console.error('Ошибка создания карточки:', createResult.error);
    rl.close();
    await client.$disconnect();
    return;
  }
  console.log(`\n✓ RelationshipCard создана (id=${cardId})\n`);

  // 4. Загружаем контекст тенанта
  const [foundation, productCards] = await Promise.all([
    store.getFoundation(tenantId),
    store.getProductCards(tenantId),
  ]);

  // Берём первую доступную карточку как "релевантную услугу"
  const productCard: ProductCard | undefined = productCards[0];

  if (!foundation) console.warn('⚠ BusinessFoundation не найдена для тенанта, черновик будет без контекста бизнеса.');
  if (!productCard) console.warn('⚠ ProductCard не найдена, черновик будет без описания услуги.');

  // 5. Генерируем черновик
  console.log('Генерирую черновик через Avi...\n');
  const draftProvider = new ClaudeDraftProvider();

  let draftText: string;
  try {
    const result = await draftProvider.draft(cardPayload, productCard, foundation);
    draftText = result.message;
  } catch (err) {
    console.error('Ошибка генерации черновика:', err);
    rl.close();
    await client.$disconnect();
    return;
  }

  // 6. Цикл подтверждения
  while (true) {
    console.log('\n─── Черновик Avi ──────────────────────────────────');
    console.log(draftText);
    console.log('────────────────────────────────────────────────────\n');

    const answer = (await ask('Отправить? (y / n / edit): ')).toLowerCase();

    if (answer === 'y') {
      // interaction_history не реализован в схеме — логируем факт
      console.log('\n[ОТПРАВЛЕНО БЫ, канал пока не подключён]');
      console.log(`[LOG] Подтверждено: tenant=${tenantId} card_id=${cardId} at=${new Date().toISOString()}`);
      break;
    }

    if (answer === 'n') {
      console.log('\nОтправка отменена. Карточка сохранена без изменений.');
      break;
    }

    if (answer === 'edit') {
      console.log('\nВведите свой текст (пустая строка = конец ввода):');
      const editLines: string[] = [];
      while (true) {
        const ln = await ask('> ');
        if (ln === '') break;
        editLines.push(ln);
      }
      const edited = editLines.join('\n').trim();
      if (edited) draftText = edited;
      // Повторяем цикл с новым текстом
      continue;
    }

    console.log('Введите y, n или edit.');
  }

  rl.close();
  await client.$disconnect();
}

main().catch((err) => {
  console.error('Критическая ошибка:', err);
  rl.close();
  process.exit(1);
});
