/*
 * Review R1–R3/R15: browser-only POS checkout regression.
 *
 * QA_EMAIL=... QA_PASSWORD=... NODE_PATH=/opt/homebrew/lib/node_modules \
 *   node tests/e2e/review-payments-2026-09-27.spec.cjs
 *
 * Uses the local vhost and a real Chrome session. It never calls the API
 * directly, persists browser storage, or prints credentials. It creates three
 * small, identifiable sales in the local Roku QA store.
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const BASE = process.env.QA_BASE_URL || 'https://vendix.com';
const PRODUCT = 'Coca-Cola 400ml';
const TOTAL = '$38.000';
const results = [];

function fixtureId() {
  return `E2E-PAY-${Date.now().toString(36).toUpperCase()}`;
}

async function scenario(name, reviewIds, scheme, fn) {
  const start = Date.now();
  try {
    const evidence = await fn();
    results.push({ name, reviewIds, scheme, status: 'passed', evidence, ms: Date.now() - start });
    process.stdout.write(`PASS ${scheme} ${name}: ${evidence}\n`);
  } catch (error) {
    const message = String(error?.message ?? error).slice(0, 1_200);
    results.push({ name, reviewIds, scheme, status: 'failed', evidence: message, ms: Date.now() - start });
    process.stderr.write(`FAIL ${scheme} ${name}: ${message}\n`);
    throw error;
  }
}

async function login(page) {
  assert(process.env.QA_EMAIL && process.env.QA_PASSWORD,
    'Set QA_EMAIL and QA_PASSWORD in the process environment.');
  for (let i = 0; i < 3; i++) {
    try {
      await page.goto(`${BASE}/auth/login`, { waitUntil: 'commit', timeout: 15_000 });
      break;
    } catch (error) {
      if (i === 2) throw error;
    }
  }
  for (let i = 0; i < 15 && !(await page.locator('input[type=email]').isVisible()); i++) {
    const retry = page.getByRole('button', { name: 'Reintentar' });
    if (await retry.isVisible()) await retry.click();
    if (i > 0 && i % 4 === 0) {
      await page.goto(`${BASE}/auth/login`, { waitUntil: 'commit' });
    }
    await page.waitForTimeout(1_000);
  }
  if (!(await page.locator('input[type=email]').isVisible())) {
    throw new Error(`Login form absent at ${page.url()}; UI=${(await page.locator('body').innerText()).slice(0, 250)}`);
  }
  // SSR may expose the login form before the Angular submit listener hydrates.
  await page.waitForTimeout(900);
  await page.locator('input[type=email]').fill(process.env.QA_EMAIL);
  await page.locator('input[type=password]').fill(process.env.QA_PASSWORD);
  await page.getByRole('button', { name: 'Iniciar Sesión' }).click();
  try {
    await page.waitForFunction(() => {
      try {
        return Boolean(JSON.parse(localStorage.getItem('vendix_auth_state') || '{}')?.tokens?.access_token);
      } catch { return false; }
    }, null, { timeout: 20_000 });
  } catch {
    throw new Error(`Authentication did not complete; URL=${page.url()}; UI=${(await page.locator('body').innerText()).slice(-450)}`);
  }
  await openPos(page);
}

async function openPos(page) {
  for (let i = 0; i < 3; i++) {
    try {
      await page.goto(`${BASE}/admin/pos`, { waitUntil: 'commit', timeout: 30_000 });
      await page.getByRole('list', { name: 'Resultados de productos' })
        .getByRole('listitem').filter({ hasText: PRODUCT }).first().waitFor({ timeout: 12_000 });
      const storyClose = page.getByRole('button', { name: 'Cerrar Tu semana en Vendix' });
      if (await storyClose.isVisible()) await storyClose.click();
      return;
    } catch {
      // A rebuilding local vhost can commit an empty Angular bootstrap.
    }
  }
  throw new Error('POS product grid did not render through the local UI.');
}

async function addProductAndOpenCheckout(page) {
  await page.getByRole('list', { name: 'Resultados de productos' })
    .getByRole('listitem').filter({ hasText: PRODUCT }).first().click();
  const checkout = page.getByRole('button', { name: `Cobrar ${TOTAL}` }).first();
  await checkout.waitFor();
  await checkout.click();
  const shell = page.locator('app-pos-checkout-shell');
  await shell.getByText('Paso 1 de 3: Pedido').waitFor();
  return shell;
}

async function openCashMethod(shell, alias = null) {
  await shell.getByRole('radio', { name: /Para llevar/ }).click();
  await shell.getByText('Paso 2 de 3: Cliente').waitFor();
  if (alias) {
    await shell.getByRole('radio', { name: /Venta con nombre o referencia/ }).click();
    await shell.getByRole('textbox', { name: 'Nombre o referencia de la venta' }).fill(alias);
    await shell.locator('button.btn-confirm').filter({ hasText: 'Siguiente' }).click();
  } else {
    await shell.getByRole('radio', { name: /Venta Anónima/ }).click();
  }
  await shell.getByText('Paso 3 de 3: Cobro').waitFor();
  await shell.getByRole('button', { name: /Contado/ }).click();
  await shell.getByRole('heading', { name: 'Método de pago' }).waitFor();
}

async function next(shell) {
  await shell.locator('button.btn-confirm').filter({ hasText: 'Siguiente' }).click();
}

async function selectByPartialLabel(combo, fragment) {
  const labels = await combo.locator('option').allTextContents();
  const label = labels.map((value) => value.trim()).find((value) => value.includes(fragment));
  assert(label, `Missing ${fragment} option in ${labels.join(' | ')}`);
  await combo.selectOption({ label });
}

async function completedReceipt(page) {
  try {
    await page.getByText('¡Venta Completada!').waitFor({ timeout: 20_000 });
  } catch {
    const visible = await page.locator('body').innerText();
    const start = visible.indexOf('Carrito Actual');
    const shell = page.locator('app-pos-checkout-shell');
    throw new Error(`Sale confirmation missing at ${page.url()}; shell: ${(await shell.innerText()).slice(-900)}; alerts: ${(await page.getByRole('alert').allTextContents()).join(' | ').slice(0, 300)}; cart: ${visible.slice(start >= 0 ? start : -1800).slice(0, 300)}`);
  }
  const confirmation = page.locator('app-pos-order-confirmation');
  const visible = await confirmation.innerText();
  const number = visible.match(/POS-\d{4}-\d+/)?.[0];
  assert(number, `Sale number absent from UI confirmation: ${visible.slice(0, 350)}`);
  return { confirmation, number };
}

async function verifyOrderDetail(page, number, amounts) {
  await page.getByRole('button', { name: 'Ver detalle' }).click();
  try {
    await page.waitForFunction(() => /^\/admin\/orders\/\d+$/.test(location.pathname),
      null, { timeout: 15_000 });
  } catch {
    throw new Error(`Ver detalle no navegó a la orden ${number}; URL=${page.url()}; UI=${(await page.locator('body').innerText().catch(() => '')).slice(-450)}`);
  }
  await page.getByRole('heading', { name: `Orden #${number}` }).waitFor();
  const historyHeading = page.getByRole('heading', { name: /Historial de Pagos/i });
  await historyHeading.waitFor();
  const cards = historyHeading.locator('xpath=..').locator(':scope > div');
  assert.equal(await cards.count(), amounts.length, 'Wrong number of payment cards in order detail');
  for (const amount of amounts) {
    assert((await cards.allTextContents()).some((text) => text.includes(amount) && /exitoso/i.test(text)),
      `No successful ${amount} payment in UI order history`);
  }
  await page.reload({ waitUntil: 'commit' });
  await historyHeading.waitFor();
  assert.equal(await cards.count(), amounts.length, 'Reload changed payment count; double submit may have duplicated it');
  return page.url();
}

async function verifyOnlyOneAliasOrder(page, alias, number) {
  await page.goto(`${BASE}/admin/orders/sales`, { waitUntil: 'commit' });
  const search = page.locator('input[placeholder="Buscar órdenes..."]');
  await search.waitFor();
  await search.fill(alias);
  const rows = page.getByRole('table').getByRole('row').filter({ hasText: alias });
  await rows.first().waitFor({ timeout: 20_000 });
  await page.waitForTimeout(800); // debounced UI search
  assert.equal(await rows.count(), 1, 'Double submit created more than one order for the unique QA alias');
  assert.match(await rows.first().innerText(), new RegExp(number));
}

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(30_000);
  const consoleErrorNames = new Set();
  page.on('console', (message) => {
    if (message.type() === 'error') {
      const name = message.text().match(/(?:NG\d+|[A-Za-z]+Error)/)?.[0] || 'OtherConsoleError';
      consoleErrorNames.add(name); // never print URLs, tokens, or request bodies
    }
  });
  try {
    await login(page);
    const alias = fixtureId();
    process.stdout.write(`QA fixture alias: ${alias}\n`);
    const shell = await addProductAndOpenCheckout(page);
    await openCashMethod(shell, alias);
    const collector = shell.locator('app-payment-collector');

    await scenario('over-transfer is rejected at Método by Siguiente and Enter',
      ['R1', 'R3'], 'sad', async () => {
        await collector.getByRole('tab', { name: 'Varios métodos' }).click();
        const legs = collector.locator('.pc-multi-leg');
        await legs.first().waitFor();
        assert.equal(await legs.count(), 1);
        await legs.nth(0).getByRole('textbox', { name: 'Monto del tramo 1' }).fill('20000');
        await legs.nth(0).getByRole('textbox', { name: 'Efectivo recibido del tramo' }).fill('20000');
        await collector.getByRole('button', { name: 'Agregar método' }).click();
        await legs.nth(1).waitFor();
        assert.equal(await legs.count(), 2);
        const options = await legs.nth(1).getByRole('combobox', { name: 'Método del tramo 2' })
          .locator('option').allTextContents();
        assert(!options.some((name) => name.trim() === 'Efectivo'), 'A duplicate cash leg was offered');
        await legs.nth(1).getByRole('textbox', { name: 'Monto del tramo 2' }).fill('20000');
        await collector.locator('.pc-multi-balance').getByText('Sobra $2.000').waitFor();
        await next(shell);
        await collector.getByRole('alert').getByText('Sobra $2.000').waitFor();
        assert(await shell.getByRole('heading', { name: 'Método de pago' }).isVisible());
        await legs.nth(1).getByRole('textbox', { name: 'Monto del tramo 2' }).press('Enter');
        await collector.locator('.pc-multi-balance').getByText('Sobra $2.000').waitFor();
        assert(await shell.getByRole('heading', { name: 'Método de pago' }).isVisible());
        assert(!(await page.getByText('¡Venta Completada!').isVisible()));
        return '20k cash + 20k transfer against 38k: visible Sobra 2k; neither Siguiente nor Enter advanced; no sale.';
      });

    await scenario('missing transfer account/reference and zero leg are rejected in-place',
      ['R2', 'R3'], 'sad/brute', async () => {
        const legs = collector.locator('.pc-multi-leg');
        await legs.nth(1).getByRole('textbox', { name: 'Monto del tramo 2' }).fill('18000');
        await next(shell);
        await collector.getByRole('alert').getByText('Selecciona la cuenta bancaria de destino.').waitFor();
        assert(await shell.getByRole('heading', { name: 'Método de pago' }).isVisible());
        await selectByPartialLabel(
          legs.nth(1).getByRole('combobox', { name: 'Cuenta bancaria de destino del tramo' }),
          'Bancolombia',
        );
        await next(shell);
        await collector.getByRole('alert').getByText('Ingresa la referencia del pago').waitFor();
        assert(await shell.getByRole('heading', { name: 'Método de pago' }).isVisible());
        await legs.nth(0).getByRole('textbox', { name: 'Monto del tramo 1' }).fill('0');
        await legs.nth(1).getByRole('textbox', { name: 'Monto del tramo 2' }).fill('38000');
        await next(shell);
        await collector.getByRole('alert').getByText('Cada tramo debe ser mayor a cero').waitFor();
        assert(await shell.getByRole('heading', { name: 'Método de pago' }).isVisible());
        return 'Blank bank, blank reference, and zero-value leg each produced an actionable block at Método.';
      });

    await scenario('two transfer legs settle once despite rapid double-click',
      ['R2', 'R3'], 'happy/brute', async () => {
        const legs = collector.locator('.pc-multi-leg');
        await legs.nth(0).getByRole('combobox', { name: 'Método del tramo 1' })
          .selectOption({ label: 'Transferencia Bancaria' });
        await legs.nth(0).getByRole('textbox', { name: 'Monto del tramo 1' }).fill('20000');
        await legs.nth(1).getByRole('textbox', { name: 'Monto del tramo 2' }).fill('18000');
        await legs.nth(0).getByRole('textbox', { name: 'Número de referencia' }).fill(`${alias}-A`);
        await legs.nth(1).getByRole('textbox', { name: 'Número de referencia' }).fill(`${alias}-B`);
        await selectByPartialLabel(
          legs.nth(0).getByRole('combobox', { name: 'Cuenta bancaria de destino del tramo' }),
          'Nequi',
        );
        // The second account chosen during the sad-path remains selected.
        await next(shell);
        await shell.getByText('Método: Varios métodos (2)').waitFor();
        await shell.locator('button.btn-confirm').filter({ hasText: 'Cobrar' }).click();
        await shell.getByText(`Monto confirmado: ${TOTAL}`).waitFor();
        // The checkout shell intentionally absorbs terminal clicks during its
        // 420 ms amount-collapse transition. Brute-force the real final CTA,
        // not that transition's anti-race window.
        await page.waitForTimeout(600);
        const button = shell.locator('button.btn-confirm').filter({ hasText: 'Cobrar' });
        const rect = await button.boundingBox();
        assert(rect, 'Final Cobrar button has no visible browser box');
        await page.mouse.dblclick(rect.x + rect.width / 2, rect.y + rect.height / 2, { delay: 25 });
        const { confirmation, number } = await completedReceipt(page);
        const receipt = await confirmation.innerText();
        assert.equal((receipt.match(/Transferencia Bancaria:/g) || []).length, 2,
          'The receipt did not show exactly two transfer legs');
        assert.match(receipt, /Total pagado:\s*\$38\.000/);
        await verifyOrderDetail(page, number, ['$20.000', '$18.000']);
        await verifyOnlyOneAliasOrder(page, alias, number);
        return `${number}: two successful payment cards totaling 38k after reload; one order found by unique alias after rapid double-click.`;
      });

    await scenario('cash over-tender yields change without raising order payment',
      ['R1'], 'happy', async () => {
        await openPos(page);
        const cashShell = await addProductAndOpenCheckout(page);
        await openCashMethod(cashShell);
        await cashShell.locator('app-payment-collector .payment-method-btn')
          .filter({ hasText: 'Efectivo' }).click();
        await cashShell.getByText('Método: Efectivo').waitFor();
        await cashShell.locator('app-payment-collector #pc-cash-received').fill('40000');
        await cashShell.getByText('Cambio').waitFor();
        assert.match(await cashShell.innerText(), /Cambio a entregar\s*\$2\.000/);
        await cashShell.locator('button.btn-confirm').filter({ hasText: 'Cobrar' }).click();
        await cashShell.getByText(`Monto confirmado: ${TOTAL}`).waitFor();
        await page.waitForTimeout(600);
        await cashShell.locator('button.btn-confirm').filter({ hasText: 'Cobrar' }).click();
        const { confirmation, number } = await completedReceipt(page);
        assert.match(await confirmation.innerText(), /Vuelto:\s*\$2\.000/);
        await verifyOrderDetail(page, number, [TOTAL]);
        return `${number}: cashier entered 40k for 38k sale, UI showed 2k change, order retained one successful 38k payment.`;
      });

    await scenario('Enter accepts every default and submits only after amount confirmation',
      ['R15'], 'happy/brute', async () => {
        await openPos(page);
        const enterShell = await addProductAndOpenCheckout(page);
        const active = enterShell.locator('.step-panel:not(.step-hidden)');
        await active.press('Enter'); // Pedido → Cliente (Para llevar)
        await enterShell.getByText('Paso 2 de 3: Cliente').waitFor();
        await active.press('Enter'); // Cliente → Cobro (Anónima)
        await enterShell.getByText('Forma de pago', { exact: true }).first().waitFor();
        await active.press('Enter'); // Contado → Método
        await enterShell.getByRole('heading', { name: 'Método de pago' }).waitFor();
        await active.press('Enter'); // Efectivo → Monto
        await enterShell.getByText('Método: Efectivo').waitFor();
        await active.press('Enter'); // Monto → Confirmado, no submit
        await enterShell.getByText(`Monto confirmado: ${TOTAL}`).waitFor();
        assert(!(await page.getByText('¡Venta Completada!').isVisible()),
          'Confirming amount incorrectly submitted the order');
        await page.waitForTimeout(600);
        await active.press('Enter'); // Cobrar
        const { number } = await completedReceipt(page);
        await verifyOrderDetail(page, number, [TOTAL]);
        return `${number}: six Enter presses chose defaults, confirmed 38k, then made one sale with one successful payment.`;
      });
  } finally {
    await browser.close();
    process.stdout.write(`REVIEW_PAYMENTS_RESULT ${JSON.stringify({
      results,
      consoleErrorNames: [...consoleErrorNames],
      allPassed: results.length === 5 && results.every((result) => result.status === 'passed'),
    })}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`SETUP_FAIL ${String(error?.message ?? error).slice(0, 500)}\n`);
  process.exitCode = 1;
});
