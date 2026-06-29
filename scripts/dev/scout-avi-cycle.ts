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

// ── Input abstraction ──────────────────────────────────────────────────────
//
// Проблема: readline обрабатывает 'line'-события синхронно при получении
// чанка. Если весь пайп приходит сразу, все события сгорают до того, как
// следующий rl.question() успевает зарегистрировать слушатель.
// Решение: если stdin — не TTY (pipe/redirect), читаем всё заранее в массив.

async function makeInputReader() {
  if (process.stdin.isTTY) {
    // ── Интерактивный режим: readline question ────────────────────────────
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    return {
      nextLine(prompt?: string): Promise<string> {
        return new Promise((resolve) =>
          rl.question(prompt ?? '', (a) => resolve(a.replace(/\r$/, '').trim())),
        );
      },
      close() { rl.close(); },
    };
  }

  // ── Нон-интерактивный режим (pipe, тестирование): читаем stdin целиком ──
  const raw = await new Promise<string>((resolve) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => { buf += chunk; });
    process.stdin.on('end', () => resolve(buf));
    process.stdin.resume();
  });
  const lines = raw.split('\n').map((l) => l.replace(/\r$/, '').trim());
  let idx = 0;

  return {
    nextLine(prompt?: string): Promise<string> {
      if (prompt) process.stdout.write(prompt);
      const line = idx < lines.length ? lines[idx++] : '';
      process.stdout.write(line + '\n'); // echo для читаемости вывода
      return Promise.resolve(line);
    },
    close() {},
  };
}

// ── detected_need (эвристика — LLM не нужен) ──────────────────────────────

function extractDetectedNeed(rawText: string): string {
  return rawText.slice(0, 300).trim();
}

// ── main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n=== Scout→Avi цикл (ручная проверка) ===\n');

  const input = await makeInputReader();

  // 1. Tenant
  const tenantRaw = await input.nextLine('tenant_id [scout_avi_demo]: ');
  const tenantId = tenantRaw || 'scout_avi_demo';
  console.log(`[debug] tenantId=${tenantId}`);

  // 2. Исходное сообщение
  console.log('\nВставьте текст сообщения, как будто нашли его в канале.');
  console.log('(пустая строка = конец ввода)\n');

  const msgLines: string[] = [];
  while (true) {
    const line = await input.nextLine('> ');
    if (line === '') break;
    msgLines.push(line);
  }
  const rawMessage = msgLines.join('\n').trim();
  console.log(`[debug] rawMessage собран (${rawMessage.length} chars): "${rawMessage.slice(0, 60)}..."`);

  if (!rawMessage) {
    console.log('Текст пустой, выход.');
    input.close();
    return;
  }

  // 3. Создаём RelationshipCard
  console.log('[debug] createPrismaClient...');
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

  console.log('[debug] store.applyAction(create_relationship_card)...');
  const createResult = await store.applyAction({
    type: 'create_relationship_card',
    payload: cardPayload,
  });

  if (!createResult.applied) {
    console.error('Ошибка создания карточки:', createResult.error);
    input.close();
    await client.$disconnect();
    return;
  }
  console.log(`\n✓ RelationshipCard создана (id=${cardId})\n`);

  // 4. Загружаем контекст тенанта
  console.log('[debug] загружаю foundation + productCards...');
  const [foundation, productCards] = await Promise.all([
    store.getFoundation(tenantId),
    store.getProductCards(tenantId),
  ]);
  console.log(`[debug] foundation=${!!foundation}, productCards=${productCards.length}`);

  const productCard: ProductCard | undefined = productCards[0];
  if (!foundation) console.warn('⚠ BusinessFoundation не найдена, черновик будет без контекста бизнеса.');
  if (!productCard) console.warn('⚠ ProductCard не найдена, черновик будет без описания услуги.');

  // 5. Генерируем черновик
  console.log('[debug] вызываю ClaudeDraftProvider.draft()...');
  console.log('Генерирую черновик через Avi...\n');
  const draftProvider = new ClaudeDraftProvider();

  let draftText: string;
  try {
    const result = await draftProvider.draft(cardPayload, productCard, foundation);
    draftText = result.message;
    console.log('[debug] черновик получен от Claude');
  } catch (err) {
    console.error('Ошибка генерации черновика:', err);
    input.close();
    await client.$disconnect();
    return;
  }

  // 6. Цикл подтверждения
  while (true) {
    console.log('\n─── Черновик Avi ──────────────────────────────────');
    console.log(draftText);
    console.log('────────────────────────────────────────────────────\n');

    const answer = (await input.nextLine('Отправить? (y / n / edit): ')).toLowerCase();

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
        const ln = await input.nextLine('> ');
        if (ln === '') break;
        editLines.push(ln);
      }
      const edited = editLines.join('\n').trim();
      if (edited) draftText = edited;
      continue;
    }

    console.log('Введите y, n или edit.');
  }

  input.close();
  await client.$disconnect();
}

main().catch((err) => {
  console.error('Критическая ошибка:', err);
  process.exit(1);
});
