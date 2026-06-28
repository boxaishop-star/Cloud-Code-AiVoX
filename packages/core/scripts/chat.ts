import 'dotenv/config';
import * as readline from 'node:readline';
import { BusinessAssistantOrchestrator } from '../src/orchestrator.js';
import { ClaudeExtractionProvider } from '../src/extraction/claudeProvider.js';
import { InMemoryStore } from '../src/toolLayer.js';
import type { ExtractionContext, ExtractionProvider, ExtractionResult } from '../src/extraction/types.js';

// ── DEBUG: временная обёртка, печатает raw ExtractionResult до валидации ──
class DebugExtractor implements ExtractionProvider {
  constructor(private inner: ClaudeExtractionProvider) {}
  async extract(userMessage: string, context: ExtractionContext): Promise<ExtractionResult> {
    const result = await this.inner.extract(userMessage, context);
    console.log('\n[DEBUG] raw ExtractionResult:');
    console.log(JSON.stringify(result, null, 2));
    return result;
  }
}

const TENANT_ID = 'cli_test';

const store = new InMemoryStore();
const orch = new BusinessAssistantOrchestrator(store, new DebugExtractor(new ClaudeExtractionProvider()));

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '\nВы: ',
});

console.log('━━━ Business Assistant AiVoX ━━━');
console.log(`Tenant: ${TENANT_ID}  |  "exit" — выход`);
console.log('');

rl.prompt();

let pending = 0;
let closed = false;

rl.on('line', async (line: string) => {
  const input = line.trim();

  if (!input) {
    rl.prompt();
    return;
  }

  if (input.toLowerCase() === 'exit') {
    console.log('До свидания!');
    rl.close();
    return;
  }

  rl.pause();
  pending++;

  try {
    const result = await orch.process({ userMessage: input, tenant_id: TENANT_ID });

    console.log(`\nАссистент:\n${result.assistantResponse}`);

    // readiness_score из хранилища — orchestrator обновляет карточку in-place
    const cards = store.getProductCards(TENANT_ID);
    if (cards.length > 0) {
      const scores = cards.map((c) => `«${c.name}» ${c.readiness_score}%`).join(', ');
      console.log(`\n[readiness: ${scores}]`);
    }

    if (result.nextStep) {
      console.log(`[next_step: ${result.nextStep.question}]`);
    }

    // всегда печатаем rejectedActions, даже пустые — для диагностики
    console.log(`[rejectedActions (${result.rejectedActions.length}): ${result.rejectedActions.join(' | ') || '—'}]`);
  } catch (err) {
    console.error('\nОшибка:', err instanceof Error ? err.message : String(err));
  } finally {
    pending--;
    if (closed && pending === 0) process.exit(0);
  }

  rl.resume();
  rl.prompt();
});

rl.on('close', () => {
  closed = true;
  if (pending === 0) process.exit(0);
  // иначе выход произойдёт в finally последнего pending-запроса
});
