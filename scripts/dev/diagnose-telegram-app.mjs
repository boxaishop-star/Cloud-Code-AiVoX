/**
 * Диагностический скрипт: my.telegram.org/apps — перехват сетевых ответов
 * при создании приложения, чтобы увидеть реальную причину ошибки.
 *
 * Usage: node scripts/dev/diagnose-telegram-app.mjs
 *
 * Браузер открывается в видимом режиме (headed). Вы вводите номер / код сами.
 * Скрипт ловит ответы сервера и выводит тело — там настоящая причина "ERROR".
 */

import { chromium } from 'playwright';

const TELEGRAM_APPS_URL = 'https://my.telegram.org/apps';
const LOGIN_URL         = 'https://my.telegram.org/auth';

let browser;
let page;

// ─── helpers ──────────────────────────────────────────────────────────────────

function ts() {
  return new Date().toTimeString().slice(0, 8);
}

function separator(label) {
  const line = '─'.repeat(Math.max(0, 54 - label.length));
  console.log(`\n[${ts()}] ─── ${label} ${line}`);
}

async function tryReadBody(response) {
  try {
    const text = await response.text();
    return text;
  } catch {
    return '<тело недоступно>';
  }
}

// ─── main ──────────────────────────────────────────────────────────────────────

async function main() {
  browser = await chromium.launch({
    headless: false,
    args: ['--window-size=1100,820'],
  });

  const context = await browser.newContext({
    viewport: { width: 1100, height: 820 },
  });
  page = await context.newPage();

  // ── Перехватываем ВСЕ ответы — фильтруем интересные ──────────────────────
  page.on('response', async (response) => {
    const url    = response.url();
    const status = response.status();
    const method = response.request().method();

    // Нас интересуют POST-запросы к my.telegram.org
    if (method !== 'POST' || !url.includes('my.telegram.org')) return;

    const body = await tryReadBody(response);

    separator(`${method} ${status} → ${url.replace('https://my.telegram.org', '')}`);
    console.log('Тело ответа:');
    try {
      // Пробуем отформатировать как JSON
      console.log(JSON.stringify(JSON.parse(body), null, 2));
    } catch {
      // Обычный текст
      console.log(body || '<пустое тело>');
    }
  });

  // ── Ловим JS-ошибки на странице ───────────────────────────────────────────
  page.on('pageerror', (err) => {
    console.log(`\n[${ts()}] [page:error] ${err.message}`);
  });

  // ── Открываем страницу ────────────────────────────────────────────────────
  console.log(`\n[${ts()}] Открываю ${TELEGRAM_APPS_URL}…`);
  await page.goto(TELEGRAM_APPS_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  // Telegram редиректит на /auth, если не залогинен
  const currentUrl = page.url();
  if (currentUrl.includes('/auth') || currentUrl.includes('login')) {
    separator('Требуется вход');
    console.log('Жду входа... введите номер и код в открывшемся окне браузера');
    console.log(`(ожидаю переход с ${page.url()} на /apps)\n`);

    // Ждём пока URL станет /apps — максимум 5 минут
    await page.waitForURL('**/apps**', { timeout: 300_000 });
    console.log(`\n[${ts()}] ✓ Вошли! URL: ${page.url()}`);
  } else {
    console.log(`[${ts()}] Уже залогинены. URL: ${currentUrl}`);
  }

  // ── Читаем содержимое страницы /apps ──────────────────────────────────────
  separator('Содержимое страницы /apps (текст)');

  // Ждём немного, чтобы страница догрузила динамические блоки
  await page.waitForTimeout(2000);

  const bodyText = await page.evaluate(() => document.body.innerText);

  // Проверяем наличие api_id / api_hash — признак уже существующего приложения
  const hasApiId   = /api_id\s*[:=]?\s*\d+/i.test(bodyText) || bodyText.includes('App api_id');
  const hasApiHash = /api_hash/i.test(bodyText);
  const hasCreateForm = /create application/i.test(bodyText);

  if (hasApiId || hasApiHash) {
    separator('✅ Приложение уже существует');
    // Вытащим только блок с api_id/api_hash, если страница длинная
    const lines = bodyText.split('\n').filter((l) =>
      /api_id|api_hash|App title|Short name/i.test(l),
    );
    if (lines.length) {
      lines.forEach((l) => console.log(' ', l.trim()));
    } else {
      console.log(bodyText.slice(0, 2000));
    }
  } else if (hasCreateForm) {
    separator('Форма создания приложения найдена');
    console.log('Заполните форму и нажмите "Create application".');
    console.log('Скрипт перехватит ответ сервера автоматически.\n');
    console.log(bodyText.slice(0, 1500));
  } else {
    separator('Страница (первые 2000 символов)');
    console.log(bodyText.slice(0, 2000));
  }

  // ── Ждём бесконечно — не закрываем браузер ────────────────────────────────
  separator('Слушаю сетевые запросы — браузер открыт');
  console.log('Нажмите "Create application" в браузере.');
  console.log('Ответ сервера появится здесь автоматически.');
  console.log('Для выхода нажмите Ctrl+C.\n');

  // Держим процесс живым
  await new Promise(() => {});
}

// ─── запуск + cleanup ──────────────────────────────────────────────────────────

process.on('SIGINT', async () => {
  console.log('\n\nЗакрываю браузер…');
  await browser?.close().catch(() => {});
  process.exit(0);
});

main().catch(async (err) => {
  console.error('Скрипт упал:', err.message);
  await browser?.close().catch(() => {});
  process.exit(1);
});
