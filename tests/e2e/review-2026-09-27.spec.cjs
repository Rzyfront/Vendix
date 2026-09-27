/*
 * Local UI-only Review E2E. Run with Playwright on the real Vendix vhost:
 * QA_EMAIL=... QA_PASSWORD=... NODE_PATH=/opt/homebrew/lib/node_modules \
 *   node tests/e2e/review-2026-09-27.spec.cjs --baseline
 *
 * No credentials or browser storage state are written to disk. A requirement
 * is not counted as passing until its Playwright scenario is registered here.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');

const allReviewIds = Array.from({ length: 21 }, (_, i) => `R${i + 1}`);
const group = process.argv.includes('--all')
  ? 'all'
  : process.argv.includes('--baseline')
    ? 'baseline'
    : process.argv[process.argv.indexOf('--group') + 1] || 'baseline';
const results = [];

async function runScenario(name, reviewIds, fn) {
  const started = Date.now();
  try {
    await fn();
    results.push({ name, reviewIds, status: 'passed', ms: Date.now() - started });
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    const message = String(error?.message ?? error).slice(0, 1200);
    results.push({ name, reviewIds, status: 'failed', ms: Date.now() - started, message });
    process.stderr.write(`FAIL ${name}: ${message}\n`);
  }
}

async function login(page) {
  assert(process.env.QA_EMAIL && process.env.QA_PASSWORD,
    'Set QA_EMAIL and QA_PASSWORD in the process environment.');
  await page.goto('https://vendix.com/auth/login', { waitUntil: 'domcontentloaded' });
  // When the backend watcher is restarting, the Angular domain bootstrap may
  // show its own retry screen. Recover through that UI, not an API probe.
  for (let attempt = 0; attempt < 4; attempt++) {
    if (await page.locator('input[type="email"]').isVisible()) break;
    if (await page.getByText('No pudimos conectar').isVisible()) {
      await page.getByRole('button', { name: 'Reintentar' }).click();
    }
    await page.waitForTimeout(1_200);
  }
  if (!(await page.locator('input[type="email"]').isVisible())) {
    throw new Error(`El formulario de acceso no apareció; UI: ${(await page.locator('body').innerText()).slice(-350)}`);
  }
  // Angular's SSR markup can expose the form before its submit listener is
  // attached. Give the dev app one hydration turn; networkidle is unsuitable
  // because the admin shell keeps long-lived notification connections open.
  await page.waitForTimeout(900);
  await page.locator('input[type="email"]').fill(process.env.QA_EMAIL);
  await page.locator('input[type="password"]').fill(process.env.QA_PASSWORD);
  if (await page.getByText('Demasiados intentos de inicio de sesión').isVisible()) {
    throw new Error('La cuenta QA sigue temporalmente bloqueada; esperar el contador de la UI.');
  }
  await page.getByRole('button', { name: 'Iniciar Sesión' }).click({ force: true });
  try {
    await Promise.race([
      page.waitForURL(/\/admin\//, { timeout: 20_000 }),
      page.getByText('Demasiados intentos de inicio de sesión').waitFor({ timeout: 20_000 })
        .then(() => { throw new Error('La cuenta QA está temporalmente bloqueada por límite de intentos; esperar el contador de la UI antes de reintentar.'); }),
    ]);
  } catch (error) {
    const visible = (await page.locator('body').innerText()).slice(-500);
    throw new Error(`${String(error?.message ?? error).slice(0, 180)}; UI: ${visible}`);
  }
  await page.getByText('Punto de Venta', { exact: true }).first().waitFor();
}

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  try {
    if (group === 'pricing' || group === 'all') {
      await runScenario('R21: storefront compares sale and regular prices with IVA included', ['R21'], async () => {
        await page.goto('https://roku-shop.vendix.com/sale', { waitUntil: 'domcontentloaded' });
        const card = page.locator('article.product-card').filter({ hasText: 'Smart TV Samsung 55" 4K UHD' });
        try {
          await card.waitFor({ timeout: 8_000 });
        } catch {
          // The dev backend may be restarting while files are edited. Retry
          // through the actual page once; never fabricate a passing card.
          await page.reload({ waitUntil: 'domcontentloaded' });
          await card.waitFor({ timeout: 12_000 });
        }
        const current = (await card.locator('.product-price .price').innerText()).trim();
        const regular = (await card.locator('.product-price .original-price').innerText()).trim();
        assert.equal(current, '$1.500.000', 'La oferta debe presentarse con su total final configurado.');
        assert.equal(regular, '$2.616.810', 'El tachado debe incluir el IVA del precio regular (base $2.199.000).');
      });

      await runScenario('R14: storefront variant switch changes the actual selling price', ['R14'], async () => {
        await page.goto('https://roku-shop.vendix.com/products/tv-samsung-55-4k', { waitUntil: 'domcontentloaded' });
        const title = page.getByRole('heading', { name: 'Smart TV Samsung 55" 4K UHD' }).first();
        await title.waitFor();
        const main = page.locator('main').first();
        const price = () => main.locator('.price-line').first().innerText();
        const initial = await price();
        await page.locator('.variants-btns button').filter({ hasText: '65"' }).click();
        await main.locator('.price-line .current-price').getByText('$3.299.000').waitFor();
        const medium = await price();
        await page.locator('.variants-btns button').filter({ hasText: '55"' }).click();
        await main.locator('.price-line .current-price').getByText('$2.199.000').waitFor();
        const small = await price();
        assert.notEqual(initial, medium, `75→65 dejó el mismo precio: ${initial}`);
        assert.notEqual(medium, small, `65→55 dejó el mismo precio: ${medium}`);
      });
    }

    if (group !== 'pricing') {
      await runScenario('baseline: login and admin navigation', [], async () => {
        await login(page);
        assert.match(page.url(), /\/admin\//);
        assert.equal(consoleErrors.length, 0, `Browser console errors: ${consoleErrors.join(' | ')}`);
      });
    }

    if (results[0]?.status === 'passed' && (group === 'lists' || group === 'all')) {
      await runScenario('R8: customer desktop table omits Estado', ['R8'], async () => {
        await page.goto('https://vendix.com/admin/customers/all', { waitUntil: 'domcontentloaded' });
        await page.getByRole('heading', { name: /clientes/i }).first().waitFor();
        const table = page.getByRole('table').first();
        await table.waitFor();
        const headers = await table.locator('thead th').allTextContents();
        assert(!headers.some((header) => header.trim() === 'Estado'),
          `Unexpected Estado column: ${headers.join(', ')}`);
      });
    }
  } finally {
    const coveredIds = new Set(results.flatMap((result) =>
      result.status === 'passed' ? result.reviewIds : []));
    const missingIds = allReviewIds.filter((id) => !coveredIds.has(id));
    const report = {
      group,
      timestamp: new Date().toISOString(),
      results,
      coveredIds: [...coveredIds],
      missingIds,
    };
    fs.writeFileSync('/tmp/vendix-review-e2e-results.json', JSON.stringify(report, null, 2));
    process.stdout.write(`UI coverage: ${coveredIds.size}/${allReviewIds.length}; missing: ${missingIds.join(', ')}\n`);
    await browser.close();
  }

  if (results.some((result) => result.status === 'failed')) process.exitCode = 1;
  if (group === 'all' && allReviewIds.some((id) =>
    !results.some((result) => result.status === 'passed' && result.reviewIds.includes(id)))) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`E2E harness failed: ${String(error?.message ?? error).slice(0, 1200)}\n`);
  process.exitCode = 1;
});
