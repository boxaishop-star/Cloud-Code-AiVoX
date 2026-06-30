/**
 * Раздел 7.1.2 ТЗ v9.1 — проверка порядка вопросов Profile Setup.
 * Показывает:
 *   1. При пустом scout_search_signals → nextStep.id = "scout_signals" (задаётся ДО customer_segments)
 *   2. Без scout_signals → checkProfileReadyForDailyAssistant = false, даже при readiness >= 80
 *   3. После заполнения scout_signals → переход в daily_assistant с сообщением "Профиль готов"
 *
 * Запуск: npx tsx scripts/dev/profile-setup-order.ts
 */
import { BusinessAssistantOrchestrator } from '../../packages/core/src/orchestrator.js';
import { MockExtractionProvider } from '../../packages/core/src/extraction/mockProvider.js';
import { InMemoryStore } from '../../packages/core/src/toolLayer.js';
import {
  checkProfileReadyForDailyAssistant,
  computeReadiness,
  computeNextStep,
} from '../../packages/core/src/nextStepController.js';
import type { ProductCard } from '../../packages/core/src/schemas/productCard.js';

const TENANT = 'scenario_7_1_2';

// Карточка со всеми полями кроме scout_search_signals — имитирует состояние
// «пользователь ответил на все вопросы кроме ключевых слов поиска».
const CARD_NO_SCOUT = {
  id: 'manicure_classic', name: 'Классический маникюр',
  category: 'Красота и уход', service_line: 'manicure_classic',
  pricing_model: 'fixed' as const, price: 1500, currency: 'RUB', unit: 'visit',
  includes: ['покрытие лаком', 'уход за кутикулой'],
  excludes: ['наращивание ногтей'], estimate_inputs: ['тип покрытия'],
  customer_segments: ['женщины 20–45'], geography: ['Москва'],
  scout_search_signals: [],          // ← пусто — ключевой момент (estimate_inputs заполнен, чтобы scout_signals шёл следующим)
  scout_sources: ['Авито', 'Яндекс.Услуги'],
  avi_qualification_questions: ['Когда вам удобно?'],
  handoff_to_human_rules: [], price_rules: [], variants: [],
  evidence: [], source: 'business_assistant' as const,
  created_from_conversation: true, readiness_score: 0, missing_fields: [],
  tenant_id: TENANT,
};

const FOUNDATION = {
  tenant_id: TENANT,
  company_description: 'Мастер маникюра в Москве',
  market_type: 'B2C' as const,
  geography: ['Москва'],
};

function sep() { console.log('─'.repeat(65)); }

async function main() {
  console.log('=== 7.1.2: порядок вопросов Profile Setup — scout_signals ===\n');

  // ── Блок 1: следующий шаг при пустом scout_signals ───────────────────────
  {
    console.log('Блок 1: computeNextStep при заполненной карточке без scout_signals');
    sep();
    const cardWithReadiness: ProductCard = {
      ...CARD_NO_SCOUT,
      ...computeReadiness(CARD_NO_SCOUT as unknown as ProductCard),
    };
    const { readiness_score, missing_fields } = cardWithReadiness;
    const nextStep = computeNextStep(cardWithReadiness);

    console.log(`readiness_score : ${readiness_score}`);
    console.log(`missing_fields  : [${missing_fields.join(', ')}]`);
    console.log(`nextStep.id     : "${nextStep?.id}"`);
    console.log(`nextStep.question: "${nextStep?.question}"`);

    const ok = nextStep?.id === 'scout_signals';
    console.log(`\n${ok ? '✓' : '✗'} Следующий вопрос${ok ? ' корректно' : ' НЕВЕРНО'} ведёт к scout_signals`);
    if (!ok) { console.error('FAIL: ожидался id=scout_signals'); process.exit(1); }
  }

  // ── Блок 2: переход заблокирован без scout_signals ────────────────────────
  {
    console.log('\n\nБлок 2: checkProfileReadyForDailyAssistant без scout_signals');
    sep();
    const cardWithReadiness: ProductCard = {
      ...CARD_NO_SCOUT,
      ...computeReadiness(CARD_NO_SCOUT as unknown as ProductCard),
    };
    console.log(`readiness_score : ${cardWithReadiness.readiness_score} (>= 80)`);
    console.log(`scout_search_signals : [] (пусто)`);

    const ready = checkProfileReadyForDailyAssistant([cardWithReadiness], FOUNDATION as any);
    console.log(`checkProfileReadyForDailyAssistant → ${ready}`);
    console.log(`${ready ? '✗ ОШИБКА: должен быть false' : '✓ false — переход заблокирован (всё правильно)'}`);
    if (ready) { console.error('FAIL'); process.exit(1); }
  }

  // ── Блок 3: оркестратор НЕ переходит без scout_signals ───────────────────
  {
    console.log('\n\nБлок 3: оркестратор — пользователь отвечает на вопрос о поиске');
    sep();
    const store = new InMemoryStore();
    // Предзагружаем карточку без scout_signals.
    await store.applyAction({ type: 'upsert_product_card', payload: CARD_NO_SCOUT });
    await store.applyAction({ type: 'upsert_business_foundation', payload: FOUNDATION });

    // Модель получает ключевые слова и обновляет карточку.
    const extractor = new MockExtractionProvider({
      'маникюр москва': {
        intent: 'product_update',
        confidence: 0.93,
        proposed_actions: [{
          type: 'update_product_card',
          payload: {
            id: 'manicure_classic',
            service_line: 'manicure_classic',
            tenant_id: TENANT,
            scout_search_signals: ['маникюр москва', 'мастер маникюра на дому', 'сделать маникюр недорого'],
          },
        }],
      },
    });

    const orch = new BusinessAssistantOrchestrator(store, extractor);
    const r = await orch.process({
      userMessage: 'По запросам: маникюр москва, мастер маникюра на дому, сделать маникюр недорого',
      tenant_id: TENANT,
    });

    console.log(`Этап до: profile_setup`);
    console.log(`Этап после: ${r.assistant_stage}`);
    console.log(`Ответ (первая строка): ${r.assistantResponse.split('\n')[0]}`);

    const ok = r.assistant_stage === 'daily_assistant' && r.assistantResponse.includes('Daily Assistant');
    console.log(`\n${ok ? '✓' : '✗'} Переход в daily_assistant${ok ? '' : ' НЕ'} произошёл`);
    if (!ok) {
      console.error('FAIL: ожидался переход в daily_assistant после заполнения scout_signals');
      process.exit(1);
    }
  }

  // ── Итог ─────────────────────────────────────────────────────────────────
  console.log('\n\n=== Все проверки прошли ✓ ===');
  console.log('\nПорядок полей PRIORITY_CHECKS (раздел 7.1.2 ТЗ v9.1):');
  const checks = ['service', 'price', 'includes', 'excludes', 'estimate_inputs',
    'scout_signals ← КРИТИЧНО для Scout', 'customer_segments', 'geography',
    'scout_sources', 'avi_questions', 'handoff_rules'];
  checks.forEach((c, i) => console.log(`  ${i + 1}. ${c}`));
  console.log('\nПереход A→B требует: readiness >= 80 + scout_search_signals непустые + foundation заполнен.');
}

main().catch((e) => { console.error(e); process.exit(1); });
