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
  await openUiView(page, `${adminBase}/auth/login`,
    page.locator('input[type="email"]'), 'El formulario de acceso');
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
      } catch { return false; }
    }, null, { timeout: 20_000 });
  } catch (error) {
    const visible = (await page.locator('body').innerText()).slice(-500);
    throw new Error(`${String(error?.message ?? error).slice(0, 180)}; UI: ${visible}`);
  }
  // The environment-change redirect can strand a successful login on /auth/.
  // Navigate via the browser to the real admin surface and require its cart.
  await openUiView(page, `${adminBase}/admin/pos`,
    page.getByText('Carrito Actual', { exact: true }), 'El POS tras login');
  await dismissWeeklyStories(page);
}

async function openUiView(page, url, visibleLocator, description) {
  let lastNavigationError = '';
  let lastView = '';
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'commit', timeout: 20_000 });
    } catch (error) {
      lastNavigationError = String(error?.message ?? error).slice(0, 180);
      await page.goto('about:blank', { waitUntil: 'commit', timeout: 5_000 }).catch(() => {});
      continue;
    }
    try {
      await visibleLocator.waitFor({ timeout: 10_000 });
      return;
    } catch {
      // Local domain bootstrap can commit a blank Angular shell after a
      // cross-vhost navigation while nginx/backend watches reconnect.
      // Retry through the browser; do not treat an empty bootstrap as a
      // product-price assertion or bypass the UI with a direct API request.
      lastView = (await page.locator('body').innerText({ timeout: 2_000 })
        .catch(() => '(sin body)')).slice(0, 300);
      await page.goto('about:blank', { waitUntil: 'commit', timeout: 5_000 }).catch(() => {});
    }
  }
  throw new Error(`${description} no apareció después de cinco navegaciones UI; URL=${url}; navegación=${lastNavigationError}; última vista=${lastView}`);
}

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  // Keep each vhost on its own tab: the admin shell holds long-lived SSE
  // connections and its cross-origin teardown can strand storefront navigation.
  let shop = await context.newPage();
  page.setDefaultTimeout(15_000);
  shop.setDefaultTimeout(15_000);
  const consoleErrors = [];
  const watchConsole = (tab) => {
    tab.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
  };
  watchConsole(page);
  watchConsole(shop);

  try {
    if (group === 'pricing' || group === 'storefront' || group === 'all') {
      if (group !== 'storefront') {
      await runScenario('R9/R21: taxed offer preview and storefront compare gross with gross', ['R9', 'R21'], async () => {
        // Samsung has no tax assignment in the Roku fixture. Exercise a
        // genuinely taxed product instead, and restore its original config.
        await login(page);
        const openTaxedProduct = async () => {
          const toggle = page.locator('app-setting-toggle[label="Activar precio de oferta"] [role=button]');
          await openUiView(page, `${adminBase}/admin/products/edit/298?fromPage=1`,
            toggle, 'El formulario de fruta con IVA');
          return toggle;
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
          await page.waitForFunction(() => location.pathname === '/admin/products',
            null, { timeout: 15_000 });

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
              await page.waitForFunction(() => location.pathname === '/admin/products',
                null, { timeout: 15_000 });
            }
          }
        }
      });

      await runScenario('R9/R21: IVA-included offer compares final price with final price', ['R9', 'R21'], async () => {
        // The Roku fixture has no product with an inclusive tax. Change the
        // existing fruit product through its editor, then restore both fields
        // through that same UI even if a storefront assertion fails.
        // The preceding additive-tax scenario usually leaves this admin tab
        // authenticated, but permit a standalone retry after login failure.
        if (!await page.evaluate(() => {
          try { return Boolean(JSON.parse(localStorage.getItem('vendix_auth_state') || '{}')?.tokens?.access_token); }
          catch { return false; }
        })) await login(page);
        const editUrl = `${adminBase}/admin/products/edit/298?fromPage=1`;
        const toggle = page.locator('app-setting-toggle[label="Activar precio de oferta"] [role=button]');
        const taxMode = page.locator('vendix-tax-inclusive-chip')
          .getByRole('button', { name: 'IVA General 19%: impuesto adicional sobre el precio unitario' });
        try {
          await openUiView(page, editUrl, taxMode, 'La fruta con IVA adicional');
          assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
          await taxMode.click();
          await page.locator('vendix-tax-inclusive-chip')
            .getByRole('button', { name: 'IVA General 19%: impuesto incluido en el precio unitario' })
            .waitFor();
          await toggle.click();
          await page.locator('app-input[formcontrolname="sale_price"] input').fill('20000');
          await page.getByText('Oferta final: $20.000').waitFor();
          await page.getByText('Impuestos incluidos en la oferta').waitFor();
          await page.getByRole('button', { name: 'Guardar', exact: true }).click();
          await page.waitForFunction(() => location.pathname === '/admin/products', null, { timeout: 15_000 });
          const card = shop.locator('article.product-card').filter({ hasText: 'Frutas Orgánicas Mix 1kg' });
          await openUiView(shop, 'https://roku-shop.vendix.com/sale', card,
            'La oferta con IVA incluido');
          assert.equal((await card.locator('.product-price .price').innerText()).trim(), '$20.000');
          assert.equal((await card.locator('.product-price .original-price').innerText()).trim(), '$22.000');
          await card.locator('.product-name').click();
          await shop.locator('main .price-line .current-price').getByText('$20.000').waitFor();
          assert.equal((await shop.locator('main .price-line .original-price').first().innerText()).trim(), '$22.000',
            'La ficha también debe tachar el regular con la misma regla de IVA incluido.');
          await shop.getByRole('button', { name: 'Comprar ahora' }).click();
          const cartLine = shop.locator('app-cart-item-card').filter({ hasText: 'Frutas Orgánicas Mix 1kg' });
          try {
            await cartLine.waitFor();
            assert.equal((await cartLine.locator('.ci-total').innerText()).trim(), '$20.000',
              'El carrito no debe volver a agregar IVA a la oferta inclusiva.');
            assert.equal((await shop.locator('.cart-summary .summary-row.total').innerText()).replace(/\s+/g, ' ').trim(),
              'Total $20.000');
          } finally {
            if (await cartLine.isVisible().catch(() => false)) {
              await cartLine.getByRole('button', { name: 'Eliminar' }).click();
              await shop.getByText('Tu carrito está vacío').waitFor();
            }
          }
        } finally {
          // The save can succeed even if redirect observation times out, so
          // always reopen the editor and inspect persisted state before exit.
          await openUiView(page, editUrl, page.locator('vendix-tax-inclusive-chip'),
            'Restaurar impuesto de fruta QA');
          const inclusive = page.locator('vendix-tax-inclusive-chip')
            .getByRole('button', { name: 'IVA General 19%: impuesto incluido en el precio unitario' });
          const activeOffer = await toggle.getAttribute('aria-pressed') === 'true';
          const activeInclusive = await inclusive.isVisible();
          if (activeOffer || activeInclusive) {
            if (activeOffer) {
              await page.locator('app-input[formcontrolname="sale_price"] input').fill('0');
              await toggle.click();
            }
            if (activeInclusive) await inclusive.click();
            await page.getByRole('button', { name: 'Guardar', exact: true }).click();
            await page.waitForFunction(() => location.pathname === '/admin/products', null, { timeout: 15_000 });
          }
          await openUiView(page, editUrl, taxMode, 'Fruta QA restaurada sin oferta ni IVA incluido');
          assert.equal(await toggle.getAttribute('aria-pressed'), 'false',
            'La oferta QA debe quedar apagada después de la prueba.');
        }
      });
      }

      if (group === 'all') {
        // R9 leaves this tab on /sale while the admin tab restores the offer.
        // A fresh storefront tab avoids reusing a stalled Vite navigation for
        // R14 and preserves independent console/error capture.
        await shop.close().catch(() => {});
        shop = await context.newPage();
        shop.setDefaultTimeout(15_000);
        watchConsole(shop);
      }

      if (group !== 'pricing') {
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
      await runScenario('R8: customer mobile cards omit Estado without hiding customer details', ['R8'], async () => {
        await page.setViewportSize({ width: 390, height: 844 });
        try {
          const firstCard = page.locator('app-customer-list app-item-list .item-card').first();
          await openUiView(page, `${adminBase}/admin/customers/all`, firstCard,
            'Las tarjetas móviles de clientes');
          await firstCard.waitFor();
          assert((await firstCard.locator('.card-title').innerText()).trim(),
            'The mobile customer card lost its customer name.');
          assert.equal(await page.locator('app-customer-list app-item-list .card-badge-wrap').count(), 0,
            'Customer status remains visible as a mobile badge.');
          const options = page.locator('app-customer-list app-options-dropdown');
          assert.equal(await options.getByRole('button', { name: 'Filtros' }).count(), 0,
            'Estado sigue ofreciéndose como filtro móvil aunque no está conectado al listado.');
          const actions = options.getByRole('button', { name: 'Acciones' });
          assert.equal(await actions.count(), 1, 'El disparador de acciones perdió su nombre accesible.');
          await actions.click();
          await options.getByRole('button', { name: 'Nuevo Cliente' }).waitFor();
          await actions.click();
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2),
            'The mobile customer list overflows horizontally.');
        } finally {
          await page.setViewportSize({ width: 1280, height: 720 });
        }
      });
      await runScenario('R8: mobile customer search preserves names without a status badge', ['R8'], async () => {
        await page.setViewportSize({ width: 390, height: 844 });
        try {
          const search = page.locator('app-customer-list input[placeholder="Buscar clientes..."]');
          await openUiView(page, `${adminBase}/admin/customers/all`, search,
            'La búsqueda móvil de clientes');
          const originalCard = page.locator('app-customer-list app-item-list .item-card').first();
          await originalCard.waitFor();
          const customerName = (await originalCard.locator('.card-title').innerText()).trim();
          const searchToken = customerName.split(/\s+/)[0];
          assert(searchToken.length >= 2, `Nombre de fixture no buscable: ${customerName}`);
          await search.fill(searchToken);
          const card = page.locator('app-customer-list app-item-list .item-card')
            .filter({ hasText: customerName }).first();
          await card.waitFor({ timeout: 20_000 });
          assert.equal((await card.locator('.card-title').innerText()).trim(), customerName);
          assert.equal(await card.locator('.card-badge-wrap').count(), 0);
          await search.fill('QA-NONEXISTENT-REVIEW-20260927');
          await page.getByText('No se encontraron clientes').waitFor({ timeout: 20_000 });
          assert.equal(await card.count(), 0);
          await search.fill(searchToken);
          await card.waitFor({ timeout: 20_000 });
          assert.equal(await card.locator('.card-badge-wrap').count(), 0);
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2),
            'La búsqueda móvil creó desbordamiento horizontal.');
        } finally {
          await page.setViewportSize({ width: 1280, height: 720 });
        }
      });
      await runScenario('R8: unauthenticated browser cannot read the customer list UI', ['R8'], async () => {
        const outsider = await browser.newContext({ ignoreHTTPSErrors: true });
        try {
          const outsiderPage = await outsider.newPage();
          await openUiView(outsiderPage, `${adminBase}/admin/customers/all`,
            outsiderPage.getByText('Prueba Gratis 14 Días').first(),
            'La portada pública ante acceso anónimo a clientes');
          assert.equal(await outsiderPage.locator('app-customer-list').count(), 0,
            'Una sesión sin autenticar recibió el listado de clientes.');
        } finally {
          await outsider.close();
        }
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
      await runScenario('R13: mobile order cards retain refund badge and current net', ['R13'], async () => {
        await page.setViewportSize({ width: 390, height: 844 });
        try {
          await openUiView(page, `${adminBase}/admin/orders/sales`,
            page.locator('input[placeholder="Buscar órdenes..."]'),
            'El listado móvil de órdenes');
          const search = page.locator('input[placeholder="Buscar órdenes..."]');
          await search.fill('POS-2026-0376');
          const partial = page.locator('app-orders-list app-item-list .item-card')
            .filter({ hasText: 'POS-2026-0376' });
          await partial.waitFor({ timeout: 20_000 });
          assert.match(await partial.locator('.card-badge-wrap').innerText(), /Reembolso parcial/);
          assert.match(await partial.locator('.card-footer').innerText(), /Neto actual[\s\S]*\$8\.000/i);
          await search.fill('POS-2026-0388');
          const full = page.locator('app-orders-list app-item-list .item-card')
            .filter({ hasText: 'POS-2026-0388' });
          await full.waitFor({ timeout: 20_000 });
          assert.match(await full.locator('.card-badge-wrap').innerText(), /Reembolsada/);
          assert.match(await full.locator('.card-footer').innerText(), /Neto actual[\s\S]*\$0(?:\D|$)/i);
        } finally {
          await page.setViewportSize({ width: 1280, height: 720 });
        }
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
      await runScenario('R10: Datáfono plus completed status finds COD tender, pending excludes it', ['R10'], async () => {
        await openUiView(page, `${adminBase}/admin/orders/sales`,
          page.getByRole('columnheader', { name: 'Neto actual' }),
          'El listado de órdenes para filtros combinados');
        const filtersButton = page.getByRole('button', { name: 'Filtros' });
        await filtersButton.click();
        const method = page.locator('.filter-section').filter({ hasText: 'Forma de pago' }).locator('select');
        const status = page.locator('.filter-section').filter({ hasText: 'Estado de Pago' }).locator('select');
        await method.selectOption({ label: 'Datáfono' });
        await page.waitForFunction(() =>
          Boolean(new URL(location.href).searchParams.get('payment_method_id')));
        const datafonoId = new URL(page.url()).searchParams.get('payment_method_id');
        assert(datafonoId, 'Datáfono did not retain a selected method ID.');
        if (!(await status.isVisible())) await filtersButton.click();
        await status.selectOption({ label: 'Completado' });
        try {
          await page.waitForFunction((id) => {
            const params = new URL(location.href).searchParams;
            return params.get('payment_method_id') === id &&
              params.get('payment_status') === 'succeeded';
          }, datafonoId);
        } catch {
          throw new Error(`Combined filters did not persist: url=${page.url()}, method=${await method.inputValue()}, status=${await status.inputValue()}`);
        }
        const search = page.locator('input[placeholder="Buscar órdenes..."]');
        await search.fill('POS-2026-0413');
        const row = page.getByRole('row').filter({ hasText: 'POS-2026-0413' });
        await row.waitFor({ timeout: 20_000 });
        assert.match(await row.innerText(), /POS-2026-0413/);

        if (!(await status.isVisible())) await filtersButton.click();
        await status.selectOption({ label: 'Pendiente' });
        try {
          await page.waitForFunction(() =>
            new URL(location.href).searchParams.get('payment_status') === 'pending');
        } catch {
          throw new Error(`Pending filter did not persist: url=${page.url()}, method=${await method.inputValue()}, status=${await status.inputValue()}`);
        }
        await page.getByText('Ninguna orden coincide con sus filtros').waitFor({ timeout: 20_000 });
        assert.equal(await row.count(), 0,
          'A settled Datáfono tender must not match the pending-status combination.');
      });
    }

    if (results[0]?.status === 'passed' && (group === 'details' || group === 'datafono' || group === 'all')) {
      if (group !== 'datafono') await runScenario('R5: settled Wallet + cash remain distinct after reload', ['R5'], async () => {
        await openUiView(page, `${adminBase}/admin/orders/1323`,
          page.getByRole('heading', { name: 'Orden #POS-2026-0382' }),
          'El detalle Wallet mixto');
        const heading = page.getByRole('heading', { name: /Historial de Pagos/i });
        const cards = heading.locator('xpath=..').locator(':scope > div');
        await cards.first().waitFor();
        assert.equal(await cards.count(), 2);
        const text = (await heading.locator('xpath=..').innerText()).toLowerCase();
        for (const expected of ['$1.000', '$37.000', 'efectivo', 'wallet', 'exitoso']) {
          assert(text.includes(expected), `Falta ${expected} en el historial mixto Wallet`);
        }
        await openUiView(page, `${adminBase}/admin/orders/1323`, heading,
          'El detalle Wallet mixto tras recarga');
        assert.equal(await cards.count(), 2, 'La recarga cambió los dos pagos Wallet/efectivo');
      });

      if (group !== 'datafono') await runScenario('R20: completed COD retains origin and one real tender after reload', ['R20'], async () => {
        await openUiView(page, `${adminBase}/admin/orders/1336`,
          page.getByRole('heading', { name: 'Orden #POS-2026-0393' }),
          'El detalle contra entrega finalizado');
        const heading = page.getByRole('heading', { name: /Historial de Pagos/i });
        const cards = heading.locator('xpath=..').locator(':scope > div');
        await cards.first().waitFor();
        assert.equal(await cards.count(), 2);
        const paymentText = (await heading.locator('xpath=..').innerText()).toLowerCase();
        assert.match(paymentText, /cancelado[\s\S]*pago contra entrega/);
        assert.match(paymentText, /\$19\.000[\s\S]*exitoso[\s\S]*efectivo/);
        assert.equal(await page.getByRole('button', { name: 'Confirmar Pago' }).count(), 0);
        assert.equal(await page.getByRole('button', { name: 'Despachar Orden' }).count(), 0);
        await openUiView(page, `${adminBase}/admin/orders/1336`, heading,
          'El detalle contra entrega finalizado tras recarga');
        assert.equal(await cards.count(), 2, 'La recarga duplicó o perdió pagos de contra entrega');
      });

      if (group !== 'details') await runScenario('R20: delivered COD settles with Datáfono and keeps its origin after reload', ['R20'], async () => {
        await openUiView(page, `${adminBase}/admin/orders/1361`,
          page.getByRole('heading', { name: 'Orden #POS-2026-0413' }),
          'El detalle contra entrega cobrado con Datáfono');
        const heading = page.getByRole('heading', { name: /Historial de Pagos/i });
        const cards = heading.locator('xpath=..').locator(':scope > div');
        await cards.first().waitFor();
        assert.equal(await cards.count(), 2, 'Debe quedar el marcador COD y un solo pago real');
        let paymentText = (await heading.locator('xpath=..').innerText()).toLowerCase();
        assert.match(paymentText, /cancelado[\s\S]*pago contra entrega/);
        assert.match(paymentText, /\$71\.000[\s\S]*exitoso[\s\S]*datáfono/);
        assert.equal(await page.getByRole('button', { name: 'Confirmar Pago' }).count(), 0);
        assert.equal(await page.locator('app-button:visible').filter({ hasText: 'Despachar Orden' }).count(), 0);
        await openUiView(page, `${adminBase}/admin/orders/1361`, heading,
          'El detalle contra entrega Datáfono tras recarga');
        assert.equal(await cards.count(), 2, 'La recarga duplicó el cobro Datáfono');
        paymentText = (await heading.locator('xpath=..').innerText()).toLowerCase();
        assert.match(paymentText, /cancelado[\s\S]*pago contra entrega[\s\S]*exitoso[\s\S]*datáfono/);
      });

      if (group !== 'details') await runScenario('R20: Datáfono config persists typed boolean and numeric values', ['R20'], async () => {
        const row = page.locator('app-responsive-data-view').first().locator('tr')
          .filter({ hasText: 'Datáfono' });
        await openUiView(page, `${adminBase}/admin/settings/payments`, row,
          'Los métodos de pago de la tienda');
        assert.match(await row.innerText(), /Activo/);
        await row.locator('button[aria-label="Editar"]').click();
        const modal = page.locator('app-modal').nth(1);
        await modal.getByText('Editar Datáfono').waitFor();
        const toggles = modal.locator('app-toggle button');
        assert.equal(await toggles.count(), 2);
        assert.equal(await toggles.nth(0).getAttribute('aria-pressed'), 'true');
        assert.equal(await toggles.nth(1).getAttribute('aria-pressed'), 'false');
        const numbers = modal.locator('input[type="number"]');
        assert.equal(await numbers.count(), 2);
        assert.deepEqual(await numbers.evaluateAll((inputs) => inputs.map((input) => input.value)),
          ['100000', '1000']);
        await modal.getByText('Cancelar', { exact: true }).click();
      });

      if (group !== 'datafono') await runScenario('R11: excessive credit abono is explained and cannot write', ['R11'], async () => {
        await openUiView(page, `${adminBase}/admin/orders/1329`,
          page.getByRole('heading', { name: 'Orden #POS-2026-0387' }),
          'El detalle de crédito');
        await page.getByRole('button', { name: 'Registrar Pago' }).first().click();
        const modal = page.locator('app-order-payment-modal');
        await modal.locator('input[placeholder="Usar monto sugerido"]').fill('40000');
        const warning = modal.locator('.credit-cap-error[role="alert"]');
        await warning.waitFor();
        assert.match(await warning.innerText(), /\$40\.000[\s\S]*\$38\.000[\s\S]*\$2\.000/);
        assert(await modal.getByRole('button', { name: 'Registrar Abono' }).isDisabled());
        await modal.getByRole('button', { name: 'Cancelar' }).click();
        await openUiView(page, `${adminBase}/admin/orders/1329`,
          page.getByRole('heading', { name: 'Orden #POS-2026-0387' }),
          'El detalle de crédito tras recarga');
        await page.getByRole('button', { name: 'Registrar Pago' }).first().click();
        await modal.getByText('Saldo pendiente máximo:').waitFor();
        assert.match(await modal.locator('.credit-cap').innerText(), /\$38\.000/);
        await modal.getByRole('button', { name: 'Cancelar' }).click();
      });
    }

    if (results[0]?.status === 'passed' && (group === 'item_cancel' || group === 'all')) {
      await runScenario('R18/R20: pending dish cancellation keeps COD amount and subtotal aligned', ['R18', 'R20'], async () => {
        const heading = page.getByRole('heading', { name: 'Orden #POS-2026-0427' });
        await openUiView(page, `${adminBase}/admin/orders/1375`, heading,
          'La orden COD con plato cancelado en pendiente');
        const dish = page.locator('.items-compact > div').filter({ hasText: 'Pollo Árabe E2E' });
        await dish.getByText('Cocina: Cancelado').waitFor();
        assert.equal(await dish.getByRole('button', { name: 'Cancelar' }).count(), 0);
        const coke = page.locator('.items-compact > div').filter({ hasText: 'Coca-Cola 400ml' });
        assert.equal(await coke.getByRole('button', { name: 'Entregar' }).count(), 1);
        const summary = page.locator('app-card').filter({
          has: page.getByRole('heading', { name: 'Resumen de Pago' }),
        });
        const summaryText = await summary.innerText();
        assert.match(summaryText, /Subtotal[\s\S]*\$38\.000[\s\S]*Envio[\s\S]*\$5\.000[\s\S]*Total[\s\S]*\$43\.000/i);
        const history = page.getByRole('heading', { name: /Historial de Pagos/i }).locator('xpath=..');
        assert.match(await history.innerText(), /\$43\.000[\s\S]*PENDIENTE[\s\S]*Pago Contra Entrega/);
        await openUiView(page, `${adminBase}/admin/orders/1375`, heading,
          'El plato cancelado tras recarga');
        assert.match(await summary.innerText(), /Subtotal[\s\S]*\$38\.000[\s\S]*Total[\s\S]*\$43\.000/i);
        assert.equal(await dish.getByRole('button', { name: 'Cancelar' }).count(), 0);
      });

      await runScenario('R18/R20: whole-order cancellation restores history without collectable debt', ['R18', 'R20'], async () => {
        const heading = page.getByRole('heading', { name: 'Orden #POS-2026-0428' });
        await openUiView(page, `${adminBase}/admin/orders/1376`, heading,
          'La orden con cocina pendiente cancelada');
        await page.locator('app-sticky-header').getByText('Cancelada', { exact: true }).waitFor();
        const dish = page.locator('.items-compact > div').filter({ hasText: 'Pollo Árabe E2E' });
        await dish.getByText('Cocina: Cancelado').waitFor();
        const summary = page.locator('app-card').filter({
          has: page.getByRole('heading', { name: 'Resumen de Pago' }),
        });
        assert.match(await summary.innerText(), /Importe original[\s\S]*\$33\.000[\s\S]*Saldo a cobrar[\s\S]*\$0/i);
        const history = page.getByRole('heading', { name: /Historial de Pagos/i }).locator('xpath=..');
        assert.match(await history.innerText(), /\$33\.000[\s\S]*CANCELADO[\s\S]*Pago Contra Entrega/);
        assert.equal(await page.getByRole('button', { name: 'Confirmar Pago' }).count(), 0);
      });
    }

    if (results[0]?.status === 'passed' && (group === 'table_cancel' || group === 'all')) {
      await runScenario('R18: table bill retains pending, preparing, ready and reversed-delivery cancellations', ['R18'], async () => {
        const total = page.locator('.totals-row--grand');
        await openUiView(page, `${adminBase}/admin/restaurant-ops/tables/session/160`,
          total, 'La cuenta de mesa con platos cancelados');
        assert.match(await total.innerText(), /Total\s*\$0/i);
        const cancelled = page.locator('.item-cancelled-badge');
        assert.equal(await cancelled.count(), 6, 'La mesa perdió alguno de sus seis platos cancelados');
        const badges = await cancelled.allInnerTexts();
        assert.equal(badges.filter((label) => label.includes('reuso')).length, 3);
        assert.equal(badges.filter((label) => label.includes('merma')).length, 3);
        const reasons = await page.locator('.item-cancelled-reason').allInnerTexts();
        for (const reason of ['QA R18 mesa pendiente', 'QA R18 mesa avanzada desechar',
          'QA R18 mesa avanzada reusar', 'QA R18 mesa lista desechar',
          'QA R18 entrega sin cobro reutilizar', 'QA R18 entrega sin cobro desechar']) {
          assert(reasons.some((line) => line.includes(reason)), `Falta motivo persistido: ${reason}`);
        }
        assert.equal(await page.getByRole('button', {
          name: 'Eliminar Pollo Árabe E2E de la cuenta', exact: true,
        }).count(), 0, 'Un plato cancelado se puede cancelar dos veces');
        assert.equal(await page.getByText('Entrega reversada', { exact: true }).count(), 2);
        assert.match(await page.locator('body').innerText(), /Entregados\s*0/);
        await openUiView(page, `${adminBase}/admin/restaurant-ops/tables/session/160`,
          total, 'La cuenta de mesa tras recarga');
        assert.match(await total.innerText(), /Total\s*\$0/i);
        assert.equal(await cancelled.count(), 6);
      });
    }

    if (results[0]?.status === 'passed' && (group === 'delivered_reverse' || group === 'all')) {
      await runScenario('R18: unpaid delivered reuse and waste persist without repeat reversal', ['R18'], async () => {
        const heading = page.getByRole('heading', { name: 'Orden #T-1790520816706-805' });
        await openUiView(page, `${adminBase}/admin/orders/1377`, heading,
          'La orden de mesa con entrega reversada');
        const item = page.locator('.items-compact > div').filter({
          hasText: 'QA R18 entrega sin cobro reutilizar',
        });
        await item.getByText('Cancelado', { exact: true }).waitFor();
        const wasted = page.locator('.items-compact > div').filter({
          hasText: 'QA R18 entrega sin cobro desechar',
        });
        await wasted.getByText('Cancelado', { exact: true }).waitFor();
        assert.equal(await item.getByRole('button', { name: 'Reversar' }).count(), 0,
          'La reversa ya aplicada no debe ofrecer un segundo reintegro');
        assert.equal(await wasted.getByRole('button', { name: 'Reversar' }).count(), 0,
          'La merma ya registrada no debe ofrecer una segunda reversa');
        const summary = page.locator('app-card').filter({
          has: page.getByRole('heading', { name: 'Resumen de Pago' }),
        });
        assert.match(await summary.innerText(), /Total\s*\$0/i);

        const stockValue = async (productId) => {
          const title = page.getByText('Inventario / Stock', { exact: true }).first();
          await openUiView(page, `${adminBase}/admin/products/edit/${productId}?fromPage=1`,
            title, `Inventario del insumo ${productId}`);
          const card = page.locator('div.p-3.bg-surface').filter({
            has: page.getByText('En inventario', { exact: true }),
          }).first();
          return (await card.locator('span.text-xl').first().innerText()).trim();
        };
        assert.equal(await stockValue(427), '-1200', 'La merma posterior al reuso no conservó el saldo físico');
        assert.equal(await stockValue(428), '560', 'La merma posterior al reuso no conservó las especias');
      });
    }

    if (results[0]?.status === 'passed' && (group === 'dispatch_oversell' || group === 'all')) {
      await runScenario('R17: oversold POS delivery dispatches and leaves exact negative stock', ['R17'], async () => {
        const heading = page.getByRole('heading', { name: 'Orden #POS-2026-0431' });
        await openUiView(page, `${adminBase}/admin/orders/1380`, heading,
          'La orden POS de envío sobrevendido');
        await page.getByText('REM2609270004', { exact: true }).waitFor();
        const note = page.getByText('REM2609270004', { exact: true }).locator('xpath=..');
        assert.match(await note.innerText(), /Entregada/);
        assert.match(await page.locator('body').innerText(), /Finalizada/);
        assert.equal(await page.getByRole('button', { name: 'Despachar Orden' }).count(), 0,
          'Una remisión entregada no debe poder despacharse dos veces');

        const stockTitle = page.getByText('Inventario / Stock', { exact: true }).first();
        await openUiView(page, `${adminBase}/admin/products/edit/2476?fromPage=1`, stockTitle,
          'El inventario de QA NoOversell A tras despacho');
        const stockCard = page.locator('div.p-3.bg-surface').filter({
          has: page.getByText('En inventario', { exact: true }),
        }).first();
        assert.equal((await stockCard.locator('span.text-xl').first().innerText()).trim(), '-1');
        const availableCard = page.locator('div.p-3.bg-surface').filter({
          has: page.getByText('Disponible', { exact: true }),
        }).first();
        assert.equal((await availableCard.locator('span.text-xl').first().innerText()).trim(), '-1');
      });
    }

    if (results[0]?.status === 'passed' && (group === 'delivered_cancel' || group === 'all')) {
      await runScenario('R18: paid delivered dish routes cancellation to refund instead of reversing stock', ['R18'], async () => {
        const heading = page.getByRole('heading', { name: 'Orden #POS-2026-0413' });
        await openUiView(page, `${adminBase}/admin/orders/1361`, heading,
          'La orden pagada con plato entregado');
        const dish = page.locator('.items-compact > div').filter({ hasText: 'Pollo Árabe E2E' });
        await dish.getByText('Entregado', { exact: true }).first().waitFor();
        assert.equal(await dish.getByRole('button', { name: 'Reversar' }).count(), 0,
          'Una venta pagada no debe ofrecer reversa directa de inventario');
        await dish.getByText('Orden cobrada: no se puede cancelar este plato.').waitFor();
        const refund = dish.getByRole('button', { name: 'Abrir Reembolso' });
        await refund.click();
        await page.getByText('Procesar Reembolso', { exact: true }).first().waitFor();
        // Read-only test: opening the refund form must not create a refund.
        assert.match(await page.locator('body').innerText(), /Reembolso/);
      });
    }

    if (results[0]?.status === 'passed' && (group === 'credit' || group === 'all')) {
      await runScenario('R7: installment down payment is a currency input in POS', ['R7'], async () => {
        await openUiView(page, `${adminBase}/admin/pos`,
          page.getByText('Carrito Actual', { exact: true }), 'El POS para crédito');
        await page.getByRole('list', { name: 'Resultados de productos' })
          .getByRole('listitem').filter({ hasText: 'Coca-Cola 400ml' }).first().click();
        await page.getByRole('button', { name: 'Cobrar $38.000' }).first().click();
        const shell = page.locator('app-pos-checkout-shell');
        await shell.getByRole('radio', { name: /Para llevar/ }).click();
        await shell.getByRole('radio', { name: /Con Cliente/ }).click();
        const search = shell.locator('app-pos-customer-selector app-inputsearch input');
        await search.fill('Camila Torres');
        await shell.locator('app-pos-customer-selector button.customer-result')
          .filter({ hasText: 'Camila Torres' }).first().click();
        await shell.getByText('Paso 3 de 3: Cobro').waitFor();
        await shell.getByRole('button', { name: /Crédito/ }).first().click();
        await shell.getByRole('button', { name: 'Cuotas', exact: true }).click();
        const initial = shell.locator('#credit-initial-payment');
        await initial.waitFor();
        const moneyField = initial.locator('xpath=..');
        assert.equal((await moneyField.locator('span').first().innerText()).trim(), '$');
        await initial.fill('1000');
        assert((await initial.inputValue()).replace(/\D/g, '').includes('1000'));
        await shell.locator('button.btn-cancel').click();
        assert(!(await page.getByText('¡Venta Completada!').isVisible()));
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
