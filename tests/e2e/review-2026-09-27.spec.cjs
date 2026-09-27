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
const adminBase = process.env.QA_BASE_URL || 'https://vendix.com';

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

async function dismissWeeklyStories(page) {
  const close = page.getByRole('button', { name: 'Cerrar Tu semana en Vendix' });
  if (await close.isVisible()) await close.click();
  const paywallClose = page.locator('app-ai-paywall-modal').getByRole('button', { name: 'Cerrar' });
  if (await paywallClose.isVisible()) await paywallClose.click();
}

async function login(page) {
  assert(process.env.QA_EMAIL && process.env.QA_PASSWORD,
    'Set QA_EMAIL and QA_PASSWORD in the process environment.');
  await page.goto(`${adminBase}/auth/login`, { waitUntil: 'commit' });
  // When the backend watcher is restarting, the Angular domain bootstrap may
  // show its own retry screen. Recover through that UI, not an API probe.
  for (let attempt = 0; attempt < 18; attempt++) {
    if (await page.locator('input[type="email"]').isVisible()) break;
    if (await page.getByText('No pudimos conectar').isVisible()) {
      await page.getByRole('button', { name: 'Reintentar' }).click();
    }
    await page.waitForTimeout(1_500);
  }
  if (!(await page.locator('input[type="email"]').isVisible())) {
    await page.reload({ waitUntil: 'commit' });
    await page.locator('input[type="email"]').waitFor({ timeout: 15_000 }).catch(() => {});
  }
  if (!(await page.locator('input[type="email"]').isVisible())) {
    throw new Error(`El formulario de acceso no apareció; UI: ${(await page.locator('body').innerText()).slice(-350)}`);
  }
  // Angular's SSR markup can expose the form before its submit listener is
  // attached. Give the dev app one hydration turn; networkidle is unsuitable
  // because the admin shell keeps long-lived notification connections open.
  await page.waitForTimeout(900);
  if (process.env.QA_ORG_SLUG || process.env.QA_STORE_SLUG) {
    await page.getByRole('button', { name: 'Seleccionar comercio (opcional)' }).click();
    if (process.env.QA_ORG_SLUG) {
      await page.getByRole('button', { name: 'Organización' }).click();
    }
    await page.locator('input[placeholder="Nombre o ID del comercio"]')
      .fill(process.env.QA_ORG_SLUG || process.env.QA_STORE_SLUG);
    await page.getByRole('button', { name: 'Confirmar' }).click();
  }
  await page.locator('input[type="email"]').fill(process.env.QA_EMAIL);
  await page.locator('input[type="password"]').fill(process.env.QA_PASSWORD);
  if (await page.getByText('Demasiados intentos de inicio de sesión').isVisible()) {
    throw new Error('La cuenta QA sigue temporalmente bloqueada; esperar el contador de la UI.');
  }
  await page.getByRole('button', { name: 'Iniciar Sesión' }).click();
  try {
    await page.waitForFunction(() => {
      try {
        const state = JSON.parse(localStorage.getItem('vendix_auth_state') || '{}');
        return Boolean(state?.tokens?.access_token && state?.user?.id);
      } catch {
        return false;
      }
    }, null, { timeout: 20_000 });
    // On the landing vhost the environment-change redirect currently strands
    // a successfully authenticated user on /auth/. Open the real admin URL
    // through the browser to verify the feature UI; report that separate
    // redirect defect rather than misclassifying it as bad credentials.
    await page.waitForTimeout(750);
    if (!/\/admin\//.test(page.url())) {
      await page.goto(`${adminBase}/admin/pos`, { waitUntil: 'commit' });
    }
  } catch (error) {
    const visible = (await page.locator('body').innerText()).slice(-500);
    throw new Error(`${String(error?.message ?? error).slice(0, 180)}; UI: ${visible}`);
  }
  try {
    await page.getByText('Punto de Venta', { exact: true }).first().waitFor({ timeout: 12_000 });
  } catch {
    await page.goto(`${adminBase}/admin/pos`, { waitUntil: 'commit' });
    try {
      await page.getByText('Punto de Venta', { exact: true }).first().waitFor({ timeout: 12_000 });
    } catch {
      throw new Error(`El POS no apareció tras login; URL=${page.url()}; UI=${(await page.locator('body').innerText()).slice(0,450)}`);
    }
  }
  await dismissWeeklyStories(page);
}

async function openUiView(page, url, visibleLocator, description) {
  let lastNavigationError = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'commit', timeout: 20_000 });
    } catch (error) {
      lastNavigationError = String(error?.message ?? error).slice(0, 180);
      continue;
    }
    try {
      await visibleLocator.waitFor({ timeout: 12_000 });
      return;
    } catch {
      // Local domain bootstrap can commit a blank Angular shell after a
      // cross-vhost navigation while nginx/backend watches reconnect.
      // Retry through the browser; do not treat an empty bootstrap as a
      // product-price assertion or bypass the UI with a direct API request.
    }
  }
  const view = await page.locator('body').innerText({ timeout: 2_000 }).catch(() => '(sin body)');
  throw new Error(`${description} no apareció después de tres navegaciones UI; URL=${page.url()}; navegación=${lastNavigationError}; vista=${view.slice(0, 300)}`);
}

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  // Keep each vhost on its own tab: the admin shell holds long-lived SSE
  // connections and its cross-origin teardown can strand storefront navigation.
  const shop = await context.newPage();
  page.setDefaultTimeout(15_000);
  shop.setDefaultTimeout(15_000);
  const consoleErrors = [];
  for (const tab of [page, shop]) {
    tab.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
  }

  try {
    if (group === 'pricing' || group === 'storefront' || group === 'all') {
      if (group !== 'storefront') {
      await runScenario('R9/R21: taxed offer preview and storefront compare gross with gross', ['R9', 'R21'], async () => {
        // Samsung has no tax assignment in the Roku fixture. Exercise a
        // genuinely taxed product instead, and restore its original config.
        await login(page);
        const openTaxedProduct = async () => {
          const toggle = page.locator('app-setting-toggle[label="Activar precio de oferta"] [role=button]');
          for (let attempt = 0; attempt < 3; attempt++) {
            await page.goto(`${adminBase}/admin/products/edit/298?fromPage=1`, { waitUntil: 'commit' });
            try {
              await toggle.waitFor({ timeout: 12_000 });
              return toggle;
            } catch {
              // The local vhost sometimes commits a blank bootstrap while
              // nginx/backend watches reconnect. Retry the actual UI page.
            }
          }
          throw new Error('El formulario de fruta con IVA no se hidrató en la UI.');
        };
        let setupAttempted = false;
        try {
          const toggle = await openTaxedProduct();
          assert.equal(await toggle.getAttribute('aria-pressed'), 'false', 'La fruta QA debe iniciar sin oferta.');
          await toggle.click();
          await page.locator('app-input[formcontrolname="sale_price"] input').fill('20000');
          await page.getByText('Oferta final: $23.800').waitFor();
          await page.getByText('Impuestos agregados a la oferta').waitFor();
          setupAttempted = true;
          await page.getByRole('button', { name: 'Guardar', exact: true }).click();
          await page.waitForURL(/\/admin\/products\?page=1/, { timeout: 15_000 });

          const card = shop.locator('article.product-card').filter({ hasText: 'Frutas Orgánicas Mix 1kg' });
          await openUiView(shop, 'https://roku-shop.vendix.com/sale', card, 'La tarjeta de oferta con IVA');
          assert.equal((await card.locator('.product-price .price').innerText()).trim(), '$23.800');
          assert.equal((await card.locator('.product-price .original-price').innerText()).trim(), '$26.180');
        } finally {
          if (setupAttempted) {
            const toggle = await openTaxedProduct();
            if (await toggle.getAttribute('aria-pressed') === 'true') {
              await page.locator('app-input[formcontrolname="sale_price"] input').fill('0');
              await toggle.click();
              await page.getByRole('button', { name: 'Guardar', exact: true }).click();
              await page.waitForURL(/\/admin\/products\?page=1/, { timeout: 15_000 });
            }
          }
        }
      });
      }

      await runScenario('R14: storefront variant switch changes the actual selling price', ['R14'], async () => {
        await openUiView(shop,
          'https://roku-shop.vendix.com/products/tv-samsung-55-4k',
          shop.getByRole('heading', { name: 'Smart TV Samsung 55" 4K UHD' }).first(),
          'La ficha de variante Samsung');
        const main = shop.locator('main').first();
        const price = () => main.locator('.price-line').first().innerText();
        const initial = await price();
        await shop.locator('.variants-btns button').filter({ hasText: '65"' }).click();
        await main.locator('.price-line .current-price').getByText('$3.299.000').waitFor();
        const medium = await price();
        await shop.locator('.variants-btns button').filter({ hasText: '55"' }).click();
        await main.locator('.price-line .current-price').getByText('$2.199.000').waitFor();
        const small = await price();
        assert.notEqual(initial, medium, `75→65 dejó el mismo precio: ${initial}`);
        assert.notEqual(medium, small, `65→55 dejó el mismo precio: ${medium}`);
      });

      await runScenario('R14: quick view follows the chosen variant instead of the base price', ['R14'], async () => {
        // Catalog cards intentionally route variants to the full product page;
        // the actual quick-view entry is the related-products carousel.
        const url = 'https://roku-shop.vendix.com/products/tv-lg-50-nanocell';
        const card = shop.locator('app-product-carousel .carousel-item')
          .filter({ hasText: 'Smart TV Samsung 55" 4K UHD' });
        await openUiView(shop, url, card, 'La recomendación Samsung');
        await card.click();
        const modal = shop.locator('app-product-quick-view-modal');
        await modal.locator('.variant-chip').first().waitFor();
        const current = modal.locator('.product-price .current-price');
        await modal.locator('.variant-chip').filter({ hasText: '65"' }).click();
        await current.getByText('$3.299.000').waitFor();
        await modal.locator('.variant-chip').filter({ hasText: '55"' }).click();
        await current.getByText('$2.199.000').waitFor();
      });

      await runScenario('R14: mobile storefront keeps variant price and selector usable', ['R14'], async () => {
        await shop.setViewportSize({ width: 390, height: 844 });
        await openUiView(shop,
          'https://roku-shop.vendix.com/products/tv-samsung-55-4k',
          shop.getByRole('heading', { name: 'Smart TV Samsung 55" 4K UHD' }).first(),
          'La ficha móvil Samsung');
        await shop.locator('.variants-btns button').filter({ hasText: '65"' }).click();
        await shop.locator('main .price-line .current-price').getByText('$3.299.000').waitFor();
        await shop.locator('.variants-btns button').filter({ hasText: '55"' }).click();
        await shop.locator('main .price-line .current-price').getByText('$2.199.000').waitFor();
      });

      await runScenario('R14: a variant without photo keeps the product gallery image', ['R14'], async () => {
        await shop.setViewportSize({ width: 1440, height: 900 });
        await openUiView(shop,
          'https://roku-shop.vendix.com/products/tv-samsung-55-4k',
          shop.getByRole('heading', { name: 'Smart TV Samsung 55" 4K UHD' }).first(),
          'La galería Samsung');
        const image = shop.locator('.main-image-wrapper img.main-image');
        const baseSrc = await image.getAttribute('src');
        assert(baseSrc, 'No base photo exists for the fallback fixture');
        for (const size of ['65"', '55"']) {
          await shop.locator('.variants-btns button').filter({ hasText: size }).click();
          assert.equal(await image.getAttribute('src'), baseSrc,
            `La variante ${size} sin foto no heredó la fotografía base`);
          assert(await image.evaluate((img) => img.complete && img.naturalWidth > 0),
            `La foto de la variante ${size} no cargó`);
        }
      });

      await runScenario('R14: selected variant reaches guest cart with its own price', ['R14'], async () => {
        await shop.setViewportSize({ width: 1440, height: 900 });
        await openUiView(shop,
          'https://roku-shop.vendix.com/products/tv-samsung-55-4k',
          shop.getByRole('heading', { name: 'Smart TV Samsung 55" 4K UHD' }).first(),
          'La ficha Samsung para carrito');
        await shop.locator('.variants-btns button').filter({ hasText: '65"' }).click();
        await shop.locator('main .price-line .current-price').getByText('$3.299.000').waitFor();
        await shop.locator('app-button button.btn-cart').click();
        await shop.locator('.cart-btn .cart-badge').getByText('1').waitFor();
        await shop.locator('.cart-btn').hover();
        await shop.locator('.cart-dropdown .cart-header').click();
        await shop.getByRole('heading', { name: 'Resumen del pedido' }).waitFor();
        await shop.locator('.summary-row.total').getByText('$3.299.000').waitFor();
        assert.match(await shop.locator('app-cart-item-card').first().innerText(), /65"/);
      });
    }

    if (group !== 'pricing' && group !== 'storefront' && group !== 'all') {
      await runScenario('baseline: login and open admin UI', [], async () => {
        await login(page);
        assert.match(page.url(), /\/admin\//);
      });
    }

    if (results[0]?.status === 'passed' && (group === 'lists' || group === 'all')) {
      await runScenario('R8: customer desktop table omits Estado', ['R8'], async () => {
        await openUiView(page, `${adminBase}/admin/customers/all`,
          page.getByRole('heading', { name: /clientes/i }).first(), 'El listado de clientes');
        await dismissWeeklyStories(page);
        await page.getByRole('heading', { name: /clientes/i }).first().waitFor();
        const table = page.getByRole('table').first();
        await table.waitFor();
        const headers = await table.locator('thead th').allTextContents();
        assert(!headers.some((header) => header.trim() === 'Estado'),
          `Unexpected Estado column: ${headers.join(', ')}`);
      });
      await runScenario('R13: orders list shows refund net and partial badge', ['R13'], async () => {
        await openUiView(page, `${adminBase}/admin/orders/sales`,
          page.getByRole('columnheader', { name: 'Neto actual' }), 'El listado de órdenes');
        await dismissWeeklyStories(page);
        await page.getByRole('columnheader', { name: 'Neto actual' }).waitFor();
        const search = page.locator('input[placeholder="Buscar órdenes..."]');
        await search.fill('POS-2026-0376');
        const row = page.getByRole('row').filter({ hasText: 'POS-2026-0376' });
        await row.waitFor({ timeout: 20_000 });
        assert.match(await row.innerText(), /Reembolso parcial/);
        assert.match(await row.innerText(), /\$8\.000/);
        await search.fill('POS-2026-0388');
        const fullyRefunded = page.getByRole('row').filter({ hasText: 'POS-2026-0388' });
        await fullyRefunded.waitFor({ timeout: 20_000 });
        const fullText = await fullyRefunded.innerText();
        assert.match(fullText, /Reembolsada/);
        assert.match(fullText, /\$0(?:\D|$)/);
      });

      await runScenario('R10: orders filter by settled payment method', ['R10'], async () => {
        await openUiView(page, `${adminBase}/admin/orders/sales`,
          page.getByRole('columnheader', { name: 'Neto actual' }), 'El listado de órdenes');
        await dismissWeeklyStories(page);
        await page.getByRole('button', { name: 'Filtros' }).click();
        const method = page.locator('.filter-section').filter({ hasText: 'Forma de pago' });
        await method.locator('select').selectOption({ label: 'Efectivo' });
        await page.waitForURL(/payment_method_id=5/, { timeout: 10_000 });
        assert.match(await method.innerText(), /Efectivo/);
        await page.getByRole('columnheader', { name: 'Neto actual' }).waitFor();
        const search = page.locator('input[placeholder="Buscar órdenes..."]');
        await search.fill('POS-2026-0382');
        const mixedTender = page.getByRole('row').filter({ hasText: 'POS-2026-0382' });
        await mixedTender.waitFor({ timeout: 20_000 });
        assert.match(await mixedTender.innerText(), /POS-2026-0382/);
      });
    }
  } finally {
    // An ID is green only when EVERY registered scenario for it is green.
    // Otherwise a passing price assertion could mask a failed photo/cart test
    // under the same R14 label, falsely claiming coverage in --all.
    const coveredIds = new Set(allReviewIds.filter((id) => {
      const scenarios = results.filter((result) => result.reviewIds.includes(id));
      return scenarios.length > 0 && scenarios.every((result) => result.status === 'passed');
    }));
    const missingIds = allReviewIds.filter((id) => !coveredIds.has(id));
    const report = {
      group,
      timestamp: new Date().toISOString(),
      results,
      consoleErrors: consoleErrors.slice(0, 30).map((message) =>
        message.replace(/token=[^'&\s]+/g, 'token=[redacted]')),
      coveredIds: [...coveredIds],
      missingIds,
    };
    fs.writeFileSync('/tmp/vendix-review-e2e-results.json', JSON.stringify(report, null, 2));
    process.stdout.write(`UI coverage: ${coveredIds.size}/${allReviewIds.length}; missing: ${missingIds.join(', ')}\n`);
    await browser.close();
  }

  if (results.some((result) => result.status === 'failed')) process.exitCode = 1;
  if (group === 'all' && allReviewIds.some((id) =>
    !results.some((result) => result.reviewIds.includes(id)) ||
    results.some((result) => result.reviewIds.includes(id) && result.status !== 'passed'))) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`E2E harness failed: ${String(error?.message ?? error).slice(0, 1200)}\n`);
  process.exitCode = 1;
});
