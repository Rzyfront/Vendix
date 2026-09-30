/*
 * Review R4/R19 — real POS browser regression, never a direct API test.
 *
 * QA_EMAIL=... QA_PASSWORD=... NODE_PATH=/opt/homebrew/lib/node_modules \
 *   node tests/e2e/review-shipping-2026-09-27.spec.cjs
 *
 * Roku local fixture (27-Sep-2026): method "Entrega Rápida Local", rates
 * "E2E-SHIPPING Agregada 10k" and "E2E-SHIPPING Incluida 15k", product
 * "Coca-Cola 400ml" at $38.000. Override labels with QA_SHIPPING_METHOD_NAME,
 * QA_ADDITIVE_RATE_LABEL, QA_INCLUSIVE_RATE_LABEL and QA_PRODUCT_NAME if the
 * store fixture changes. Two paid QA orders intentionally remain as UI audit
 * evidence; aliases are unique. No password, browser state, or token is saved.
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const BASE = process.env.QA_BASE_URL || 'https://vendix.com';
const METHOD = process.env.QA_SHIPPING_METHOD_NAME || 'Entrega Rápida Local';
const ADDITIVE = process.env.QA_ADDITIVE_RATE_LABEL || 'E2E-SHIPPING Agregada 10k';
const INCLUSIVE = process.env.QA_INCLUSIVE_RATE_LABEL || 'E2E-SHIPPING Incluida 15k';
const PRODUCT = process.env.QA_PRODUCT_NAME || 'Coca-Cola 400ml';
const ONLY = process.env.QA_SHIPPING_ONLY || '';
const PREVIEW_ONLY = process.env.QA_SHIPPING_PREVIEW_ONLY === '1';
const RESULTS = [];

function alias(suffix) {
  return `E2E-SHIP-${suffix}-${Date.now().toString(36).toUpperCase()}`;
}

async function scenario(name, scheme, fn) {
  if (ONLY && !name.toLowerCase().includes(ONLY.toLowerCase())) return;
  const started = Date.now();
  try {
    const evidence = await fn();
    RESULTS.push({ name, reviewIds: ['R4', 'R19'], scheme, status: 'passed', evidence,
      ms: Date.now() - started });
    process.stdout.write(`PASS ${scheme} ${name}: ${evidence}\n`);
  } catch (error) {
    const message = String(error?.message ?? error).slice(0, 1_000);
    RESULTS.push({ name, reviewIds: ['R4', 'R19'], scheme, status: 'failed',
      evidence: message, ms: Date.now() - started });
    process.stderr.write(`FAIL ${scheme} ${name}: ${message}\n`);
    throw error;
  }
}

async function openView(page, url, ready, attempts = 8) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'commit', timeout: 30_000 });
      await ready.waitFor({ timeout: 12_000 });
      return;
    } catch {
      // A local watch rebuild can commit an unhydrated Angular shell.
      await page.goto('about:blank', { waitUntil: 'commit', timeout: 5_000 }).catch(() => {});
    }
  }
  throw new Error(`UI did not render ${url} after ${attempts} attempts; current URL=${page.url()}`);
}

async function login(page) {
  assert(process.env.QA_EMAIL && process.env.QA_PASSWORD,
    'QA_EMAIL and QA_PASSWORD must be supplied as environment variables.');
  await openView(page, `${BASE}/auth/login`, page.locator('input[type=email]'));
  // The SSR form may exist before Angular has attached its submit listener.
  await page.waitForTimeout(900);
  await page.locator('input[type=email]').fill(process.env.QA_EMAIL);
  await page.locator('input[type=password]').fill(process.env.QA_PASSWORD);
  const locked = page.getByText('Demasiados intentos de inicio de sesión');
  if (await locked.isVisible()) throw new Error('Local login rate limit is active; wait for its UI countdown.');
  await page.getByRole('button', { name: 'Iniciar Sesión' }).click();
  await page.waitForFunction(() => {
    try {
      return Boolean(JSON.parse(localStorage.getItem('vendix_auth_state') || '{}')
        ?.tokens?.access_token);
    } catch { return false; }
  }, null, { timeout: 20_000 });
  await openPos(page);
}

async function openPos(page) {
  const product = page.getByRole('list', { name: 'Resultados de productos' })
    .getByRole('listitem').filter({ hasText: PRODUCT }).first();
  await openView(page, `${BASE}/admin/pos`, product);
  const storyClose = page.getByRole('button', { name: 'Cerrar Tu semana en Vendix' });
  if (await storyClose.isVisible()) await storyClose.click();
}

async function startDelivery(page, saleAlias) {
  await openPos(page);
  await page.getByRole('list', { name: 'Resultados de productos' })
    .getByRole('listitem').filter({ hasText: PRODUCT }).first().click();
  const checkout = page.getByRole('button', { name: /Cobrar \$38\.000/ }).first();
  await checkout.waitFor();
  await checkout.click();
  const shell = page.locator('app-pos-checkout-shell');
  await shell.getByRole('radio', { name: /Domicilio/ }).click();
  // First click changes the option; unlike reselecting the default, it does
  // not advance automatically. Continue explicitly through the footer.
  await next(shell);
  await shell.getByText('Paso 2 de 4: Cliente').waitFor();
  await shell.getByRole('radio', { name: /Venta con nombre o referencia/ }).click();
  await shell.getByRole('textbox', { name: 'Nombre o referencia de la venta' }).fill(saleAlias);
  await next(shell); // Cliente sub-step Alias → Dirección
  const shipping = shell.locator('app-pos-shipping-step');
  // This TemplateRef belongs to the shipping component but Angular projects
  // it into Cliente outside the app-pos-shipping-step host.
  const clientDetails = shell.locator('.client-delivery-details');
  const method = clientDetails.locator('.method-grid[aria-label="Método de domicilio"] button')
    .filter({ hasText: METHOD });
  await method.waitFor();
  await method.click();
  assert.equal(await method.getAttribute('aria-pressed'), 'true',
    `The ${METHOD} shipping method was not selected in the UI.`);
  return { shell, shipping, clientDetails };
}

async function fillAddress(clientDetails, city, state) {
  const form = clientDetails.locator('app-address-form-fields');
  await form.locator('app-input[formcontrolname="address_line1"] input')
    .fill('Carrera 26 con Calle 14H Bis');
  await form.locator('app-input[formcontrolname="city"] input').fill(city);
  await form.locator('app-input[formcontrolname="state_province"] input').fill(state);
  await form.locator('app-input[formcontrolname="phone_number"] input').fill('3001234567');
}

async function next(shell) {
  const button = shell.locator('button.btn-confirm').filter({ hasText: 'Siguiente' });
  if (!(await button.isVisible())) {
    const visible = (await shell.innerText()).slice(0, 460);
    throw new Error(`Siguiente no aparece en este subpaso: ${visible}`);
  }
  await button.click();
}

async function selectRate(shipping, name) {
  const selector = shipping.locator('.rate-select select');
  await selector.waitFor({ timeout: 20_000 });
  const options = (await selector.locator('option').allTextContents()).map((s) => s.trim());
  const label = options.find((s) => s.includes(name));
  assert(label, `Expected rate ${name} absent from UI selector: ${options.join(' | ')}`);
  await selector.selectOption({ label });
  return label;
}

async function expectShipping(shipping, gross, tax, mode) {
  const costCard = shipping.locator('.cost-card');
  try {
    await costCard.locator('.cost-row').filter({ hasText: 'Costo de envío' })
      .getByText(gross).waitFor({ timeout: 20_000 });
    await costCard.locator('.cost-row').filter({ hasText: `Impuesto (${mode})` })
      .getByText(tax).waitFor();
  } catch (error) {
    const componentState = await shipping.evaluate((host) => {
      const component = globalThis.ng?.getComponent?.(host);
      return component ? {
        shippingCost: component.shippingCost?.(),
        manualShippingPrice: component.manualShippingPrice?.(),
        manualQuote: component.manualQuotedShippingTax?.(),
        quoteError: component.quoteError?.(),
        calculating: component.isCalculatingShipping?.(),
        quoteGeneration: component.quoteGeneration,
      } : null;
    }).catch(() => null);
    throw new Error(`${error.message}\nRendered shipping cost card: ${await costCard.innerText().catch(() => '<missing>')}\n` +
      `Manual input: ${await shipping.locator('.manual-cost-input input').inputValue().catch(() => '<missing>')}\n` +
      `Component state: ${JSON.stringify(componentState)}\n` +
      `Shipping UI: ${(await shipping.innerText().catch(() => '<missing>')).slice(0, 1800)}`);
  }
  assert.match(await costCard.locator('.cost-row').filter({ hasText: 'Base envío' }).innerText(),
    /\$[\d.,]+/, 'The fiscal shipping base was not visible in the POS preview.');
}

async function editShipping(shipping, typedAmount) {
  await shipping.getByRole('button', { name: 'Editar costo de envío manualmente' }).click();
  const input = shipping.locator('.manual-cost-input input');
  await input.waitFor();
  await input.fill(String(typedAmount));
  await input.blur();
}

async function finishCashSale(page, shell, expectedTotal, saleAlias) {
  await next(shell);
  await shell.getByText('Paso 4 de 4: Cobro').waitFor();
  await shell.getByRole('button', { name: /Contado/ }).click();
  await shell.getByRole('heading', { name: 'Método de pago' }).waitFor();
  await shell.locator('app-payment-collector .payment-method-btn')
    .filter({ hasText: 'Efectivo' }).click();
  await shell.getByText('Método: Efectivo').waitFor();
  // Delivery Cobro is the terminal step. Unlike pickup, its footer says
  // Finalizar venta and calls the collector directly; there is no Siguiente.
  const finalButton = shell.locator('button.btn-confirm').filter({ hasText: 'Finalizar venta' });
  await finalButton.click();
  const completed = page.getByText('¡Pedido con Envío!', { exact: true });
  await completed.waitFor({ timeout: 20_000 });
  const confirmation = page.locator('app-pos-order-confirmation');
  const receipt = await confirmation.innerText();
  const number = receipt.match(/POS-\d{4}-\d+/)?.[0];
  assert(number, `Receipt lacked an order number: ${receipt.slice(0, 300)}`);
  assert(receipt.includes(expectedTotal), `Receipt did not contain ${expectedTotal}.`);
  await page.getByRole('button', { name: 'Ver detalle' }).click();
  const detailHeading = page.getByRole('heading', { name: `Orden #${number}` });
  try {
    await detailHeading.waitFor({ timeout: 8_000 });
  } catch {
    // If HMR left a blank Angular bootstrap after the receipt's navigation,
    // retry only the detail URL already chosen by the visible UI. Never pay or
    // create the sale a second time to recover a read-only navigation.
    const detailUrl = page.url();
    if (/\/admin\/orders\/\d+$/.test(new URL(detailUrl).pathname)) {
      await openView(page, detailUrl, detailHeading, 8);
    } else {
      // The receipt is authoritative that this sale already succeeded. Recover
      // through the visible order list, searching the unique alias and opening
      // that row; never submit or pay the sale again.
      await openView(page, `${BASE}/admin/orders/sales`,
        page.locator('input[placeholder="Buscar órdenes..."]'), 8);
      await page.locator('input[placeholder="Buscar órdenes..."]').fill(saleAlias);
      const row = page.getByRole('table').getByRole('row').filter({ hasText: saleAlias });
      await row.first().waitFor({ timeout: 20_000 });
      assert.equal(await row.count(), 1, 'UI recovery found a duplicate alias order.');
      assert((await row.first().innerText()).includes(number),
        'UI recovery alias row did not match the receipt order number.');
      await row.first().click();
      await detailHeading.waitFor({ timeout: 20_000 });
    }
  }
  const detailUrl = page.url();
  await page.reload({ waitUntil: 'commit' });
  await page.getByRole('heading', { name: `Orden #${number}` }).waitFor();
  return { number, detailUrl };
}

async function verifyDetail(page, expectedShipping, expectedTax, expectedTotal, mode) {
  const summary = page.locator('app-card').filter({
    has: page.getByRole('heading', { name: 'Resumen de Pago' }),
  });
  const shippingRow = summary.getByText('Envio', { exact: true }).locator('xpath=..');
  assert((await shippingRow.innerText()).includes(expectedShipping),
    `Persisted order detail lost shipping ${expectedShipping}.`);
  const label = mode === 'Agregado' ? /Base \+.*IVA/i : /Incluye.*IVA/i;
  const taxRow = summary.getByText(label).locator('xpath=..');
  assert((await taxRow.innerText()).includes(expectedTax),
    `Persisted order detail lost ${mode} shipping tax ${expectedTax}.`);
  const totalRow = summary.getByText('Total', { exact: true }).locator('xpath=..');
  assert((await totalRow.innerText()).includes(expectedTotal),
    `Persisted order detail total differs from ${expectedTotal}.`);
}

async function verifyUniqueAlias(page, saleAlias, number) {
  await openView(page, `${BASE}/admin/orders/sales`,
    page.locator('input[placeholder="Buscar órdenes..."]'));
  await page.locator('input[placeholder="Buscar órdenes..."]').fill(saleAlias);
  const rows = page.getByRole('table').getByRole('row').filter({ hasText: saleAlias });
  await rows.first().waitFor({ timeout: 20_000 });
  await page.waitForTimeout(800); // UI search debounce
  assert.equal(await rows.count(), 1, 'A repeated UI submit created duplicate alias orders.');
  assert((await rows.first().innerText()).includes(number));
}

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const consoleErrorNames = new Set();
  const manualQuoteEvidence = [];
  page.on('requestfinished', async (request) => {
    if (!request.url().includes('/shipping/manual-quote')) return;
    const response = await request.response().catch(() => null);
    manualQuoteEvidence.push({ request: request.postData(), status: response?.status(),
      response: await response?.text().catch(() => null) });
  });
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    consoleErrorNames.add(message.text().match(/(?:NG\d+|[A-Za-z]+Error)/)?.[0] || 'OtherConsoleError');
  });
  try {
    await login(page);

    await scenario('alias requires a valid address, then auto-quotes Riohacha without a customer',
      'sad/happy', async () => {
        const saleAlias = alias('ADD');
        const { shell, shipping, clientDetails } = await startDelivery(page, saleAlias);
        await next(shell);
        await clientDetails.getByRole('alert').getByText('Completa la dirección de entrega').waitFor();
        assert(await shell.getByText('Paso 2 de 4: Cliente').isVisible(),
          'An incomplete alias delivery advanced despite no address.');
        await fillAddress(clientDetails, 'Riohacha', 'La Guajira');
        await next(shell);
        await shell.getByText('Paso 3 de 4: Envío').waitFor();
        await selectRate(shipping, ADDITIVE);
        await expectShipping(shipping, '$11.900', '$1.900', 'Agregado');
        assert(!(await shipping.getByText('No hay tarifa para el método').isVisible()),
          'Alias address did not receive its automatic shipping rate.');
        await editShipping(shipping, 12000);
        await expectShipping(shipping, '$14.280', '$2.280', 'Agregado');
        assert((await shipping.getByRole('note').innerText()).includes('es la base'),
          'The manual amount did not explain additive tax treatment.');
        const { number } = await finishCashSale(page, shell, '$52.280', saleAlias);
        await verifyDetail(page, '$14.280', '$2.280', '$52.280', 'Agregado');
        await verifyUniqueAlias(page, saleAlias, number);
        return `${number}: alias + Riohacha auto-rate 11.900, manual base 12.000 → freight 14.280/IVA 2.280, detail after reload 52.280; unique alias order.`;
      });

    await scenario('selected inclusive tariff keeps gross manual amount and persisted IVA',
      'happy/brute', async () => {
        const saleAlias = alias('INC');
        const { shell, shipping, clientDetails } = await startDelivery(page, saleAlias);
        await fillAddress(clientDetails, 'Riohacha', 'La Guajira');
        await next(shell);
        await shell.getByText('Paso 3 de 4: Envío').waitFor();
        await selectRate(shipping, INCLUSIVE);
        await expectShipping(shipping, '$15.000', '$2.395', 'Incluido');
        await editShipping(shipping, 18000);
        await expectShipping(shipping, '$18.000', '$2.874', 'Incluido');
        assert((await shipping.getByRole('note').innerText()).includes('incluye el impuesto'),
          'The manual amount did not explain inclusive tax treatment.');
        if (PREVIEW_ONLY) {
          await shell.locator('button.btn-cancel').click();
          return 'UI-only preview: selected inclusive rate 15.000; manual gross 18.000 and IVA 2.874 updated before finalizing; sale intentionally not created.';
        }
        const { number } = await finishCashSale(page, shell, '$56.000', saleAlias);
        await verifyDetail(page, '$18.000', '$2.874', '$56.000', 'Incluido');
        await verifyUniqueAlias(page, saleAlias, number);
        return `${number}: inclusive rate 15.000, manual gross 18.000/IVA 2.874, detail after reload 56.000; unique alias order.`;
      });

    await scenario('out-of-coverage city rejects automatic quote and blocks payment',
      'sad/brute', async () => {
        const { shell, shipping, clientDetails } = await startDelivery(page, alias('NOCOVER'));
        await fillAddress(clientDetails, 'Bogotá', 'Bogotá, Distrito Capital');
        await next(shell);
        await shell.getByText('Paso 3 de 4: Envío').waitFor();
        await shipping.getByRole('alert').getByText('No hay tarifa para el método y la dirección elegidos.',
          { exact: false }).waitFor({ timeout: 20_000 });
        await next(shell);
        assert(await shell.getByText('Paso 3 de 4: Envío').isVisible(),
          'Uncovered destination advanced to payment without an applicable rate.');
        assert(!(await page.getByText('¡Pedido con Envío!').isVisible()));
        await shell.locator('button.btn-cancel').click();
        return 'Bogotá had no matching local QA rate; UI explained coverage and did not advance to Cobro or create an order.';
      });
  } finally {
    await browser.close();
    process.stdout.write(`REVIEW_SHIPPING_RESULT ${JSON.stringify({
      results: RESULTS, consoleErrorNames: [...consoleErrorNames], manualQuoteEvidence,
      allPassed: RESULTS.length === (ONLY ? 1 : 3)
        && RESULTS.every((item) => item.status === 'passed'),
    })}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`SETUP_FAIL ${String(error?.message ?? error).slice(0, 500)}\n`);
  process.exitCode = 1;
});
