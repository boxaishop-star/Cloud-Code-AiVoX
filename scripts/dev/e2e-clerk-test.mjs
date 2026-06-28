/**
 * One-off e2e diagnostic: Clerk sign-in ticket → headless Chromium → /api/chat
 *
 * Usage:   node scripts/dev/e2e-clerk-test.mjs
 * Requires: API server running on localhost:3000  (npm run dev --workspace=apps/api)
 *
 * Safe to re-run when you need to manually verify the auth flow.
 * The minimal HTTP server serves ONLY get-token.html — no other path is accessible.
 */

import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT  = path.resolve(__dirname, '../..');
const HTML_PATH  = path.join(REPO_ROOT, 'get-token.html');
const PORT       = 8088;

// Read from env so the script works without hardcoded secrets if .env is loaded
const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY  ?? 'sk_test_e20eE0VnCGIpvit1qDnmimQ55a6vIuIbb1cwRKI1QF';
const USER_ID          = process.env.TEST_CLERK_USER_ID ?? 'user_3Fl3fNg4g0WqfPOQHwiSGw9UEtR';
const CLERK_DOMAIN     = 'fancy-newt-55.accounts.dev';

let server;
let browser;

// ─── minimal HTTP server: only get-token.html, everything else → 404 ─────────
function startServer() {
  const html = fs.readFileSync(HTML_PATH, 'utf-8');
  server = http.createServer((req, res) => {
    const urlPath = (req.url ?? '/').split('?')[0];
    if (urlPath === '/' || urlPath === '/get-token.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } else {
      res.writeHead(404);
      res.end('404');
    }
  });
  return new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve));
}

// ─── Clerk Backend API: create sign-in token ─────────────────────────────────
async function generateTicketUrl() {
  const resp = await fetch('https://api.clerk.com/v1/sign_in_tokens', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${CLERK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ user_id: USER_ID }),
  });
  if (!resp.ok) throw new Error(`Clerk API error ${resp.status}: ${await resp.text()}`);
  const { token } = await resp.json();
  const redirectUrl = encodeURIComponent(`http://localhost:${PORT}/get-token.html`);
  return `https://${CLERK_DOMAIN}/sign-in?__clerk_ticket=${token}&redirect_url=${redirectUrl}`;
}

// ─── main ──────────────────────────────────────────────────────────────────────
async function main() {
  // 1. Minimal server
  await startServer();
  console.log(`✓ Minimal HTTP server: http://localhost:${PORT}/get-token.html (only this path)`);

  // 2. Ticket
  const ticketUrl = await generateTicketUrl();
  console.log('✓ Sign-in ticket generated');

  // 3. Browser
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Surface page-level JS errors for debugging
  page.on('console', msg => {
    if (msg.type() === 'error') console.log(`  [browser:error] ${msg.text()}`);
  });
  page.on('pageerror', err => console.log(`  [browser:pageerror] ${err.message}`));

  // 4. Navigate: Clerk sign-in → redirect to our page
  console.log('→ Navigating to Clerk (ticket sign-in)…');
  await page.goto(ticketUrl, { waitUntil: 'load', timeout: 30_000 });

  console.log('→ Waiting for redirect to localhost:8088…');
  await page.waitForURL(`http://localhost:${PORT}/**`, { timeout: 30_000 });
  console.log(`✓ Arrived at: ${page.url()}`);

  // 5. Wait until get-token.html has either a result or an error
  //    (both start as display:none; JS sets display:block when ready)
  console.log('→ Waiting for /api/chat response (up to 60 s)…');
  await page.waitForFunction(
    () => {
      const ok  = document.getElementById('api-result');
      const err = document.getElementById('api-error');
      const cdnErr = document.getElementById('cdn-error');
      const visible = el => el && el.style.display !== 'none';
      return visible(ok) || visible(err) || visible(cdnErr);
    },
    { timeout: 60_000 },
  );

  // 6. Read what appeared
  const statusText    = await page.textContent('#status');
  const resultVisible = await page.$eval('#api-result',  el => el.style.display !== 'none');
  const errorVisible  = await page.$eval('#api-error',   el => el.style.display !== 'none');
  const cdnVisible    = await page.$eval('#cdn-error',   el => el.style.display !== 'none');

  console.log('\n══════════════════════════════════════════════════');
  console.log('STATUS :', statusText?.trim());

  if (cdnVisible) {
    console.log('❌ Clerk CDN failed to load (cdn-error block visible)');
    process.exitCode = 1;
  } else if (errorVisible) {
    const errText = await page.textContent('#api-error');
    console.log('❌ fetch() error:', errText?.trim());
    process.exitCode = 1;
  } else if (resultVisible) {
    const raw = await page.textContent('#api-result');
    const jsonStart = raw.indexOf('{');
    const httpLine  = raw.split('\n')[0].trim();      // e.g. "HTTP 200"
    let parsed;
    try   { parsed = JSON.parse(raw.slice(jsonStart)); }
    catch { parsed = null; }

    console.log(httpLine);
    if (parsed) {
      console.log('intent     :', parsed.intent);
      console.log('confidence :', parsed.confidence);
      console.log('applied    :', parsed.appliedActions?.[0]?.applied);
      console.log('role       :', parsed._auth?.role);
      console.log('\nFull JSON:');
      console.log(JSON.stringify(parsed, null, 2));
    } else {
      console.log('Raw result :', raw);
    }
  }
  console.log('══════════════════════════════════════════════════');
}

main()
  .catch(err => {
    console.error('\n✗ Script failed:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await browser?.close();
    server?.close();
    console.log('\n✓ Browser closed, server stopped.');
  });
