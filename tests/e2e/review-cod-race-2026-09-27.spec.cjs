/*
 * R20 UI concurrency regression. Creates one fresh COD order through POS and
 * submits payment from two independent Chromium processes. The second process
 * avoids the admin shell's per-browser SSE connection pressure in local QA.
 *
 * QA_COD_RACE_RUN=1 QA_EMAIL=... QA_PASSWORD=... \
 * NODE_PATH=/opt/homebrew/lib/node_modules \
 * node tests/e2e/review-cod-race-2026-09-27.spec.cjs
 *
 * Only the browser drives functional requests; no direct API calls or DB writes.
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const BASE = 'https://vendix.com';
const PRODUCT = 'Coca-Cola 400ml';

async function openView(page, url, ready, label) {
  let last = '';
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'commit', timeout: 25_000 });
      await ready.waitFor({ timeout: 12_000 });
      return;
    } catch (error) {
      last = `${String(error?.message ?? error).slice(0, 180)}; ` +
        (await page.locator('body').innerText().catch(() => '')).slice(-250);
      await page.goto('about:blank', { waitUntil: 'commit' }).catch(() => {});
    }
  }
  throw new Error(`${label} did not render in the browser: ${last}`);
}

async function login(page) {
  await openView(page, `${BASE}/auth/login`, page.locator('input[type=email]'), 'Login');
  await page.waitForTimeout(900);
  await page.locator('input[type=email]').fill(process.env.QA_EMAIL);
  await page.locator('input[type=password]').fill(process.env.QA_PASSWORD);
  await page.getByRole('button', { name: 'Iniciar Sesión' }).click();
  await page.waitForFunction(() => {
    try {
      return Boolean(JSON.parse(localStorage.getItem('vendix_auth_state') || '{}')?.tokens?.access_token);
    } catch { return false; }
  }, null, { timeout: 20_000 });
  await openView(page, `${BASE}/admin/pos`,
    page.getByRole('list', { name: 'Resultados de productos' }).getByRole('listitem').first(),
    'POS');
  const storyClose = page.getByRole('button', { name: 'Cerrar Tu semana en Vendix' });
  if (await storyClose.isVisible()) await storyClose.click();
}

async function next(shell) {
  await shell.locator('button.btn-confirm').filter({ hasText: 'Siguiente' }).click();
}

async function createCodOrder(page) {
  const cart = page.getByText('Carrito Actual', { exact: true }).locator('xpath=..');
  assert.match(await cart.innerText(), /0 ítems seleccionados|Tu carrito está vacío/,
    'The QA POS cart must be empty before creating a race fixture.');
  await page.getByRole('list', { name: 'Resultados de productos' })
    .getByRole('listitem').filter({ hasText: PRODUCT }).first().click();
  await page.getByRole('button', { name: 'Cobrar $38.000' }).first().waitFor();
  await page.getByRole('button', { name: 'Cobrar $38.000' }).first().click();
  const shell = page.locator('app-pos-checkout-shell');
  await shell.getByText('Paso 1 de 3: Pedido').waitFor();
  await shell.getByRole('radio', { name: /Domicilio/ }).click();
  await next(shell);
  await shell.getByText('Paso 2 de 4: Cliente').waitFor();
  await shell.getByRole('radio', { name: /Venta con nombre o referencia/ }).click();
  await next(shell);
  await shell.getByText('Alias de venta').waitFor();
  const alias = `QA-COD-RACE-${Date.now()}`;
  await shell.locator('input[placeholder="Ej.: Mesa 5, Juan del taller"]').fill(alias);
  await shell.locator('.client-delivery-details .method-grid[aria-label="Método de domicilio"] button')
    .filter({ hasText: 'Entrega Rápida Local' }).click();
  const address = shell.locator('app-address-form-fields');
  await address.locator('app-input[formcontrolname="address_line1"] input')
    .fill('Carrera 26 con Calle 14H Bis');
  await address.locator('app-input[formcontrolname="city"] input').fill('Riohacha');
  await address.locator('app-input[formcontrolname="state_province"] input').fill('La Guajira');
  await address.locator('app-input[formcontrolname="phone_number"] input').fill('3001234567');
  await next(shell);
  await shell.getByText('Paso 3 de 4: Envío').waitFor();
  assert.match(await shell.innerText(), /Costo de envío \(automático\)[\s\S]*\$5\.000/);
  await next(shell);
  await shell.getByText('Paso 4 de 4: Cobro').waitFor();
  await shell.getByRole('button', { name: /Contado/ }).first().click();
  await page.waitForTimeout(350);
  const methodHeading = shell.getByRole('heading', { name: 'Método de pago' });
  if (!(await methodHeading.isVisible())) await next(shell);
  await page.waitForTimeout(350);
  // Some POS revisions auto-advance after choosing Contado. If Siguiente
  // raced with that transition, return from the amount sub-step to the grid.
  if (!(await methodHeading.isVisible()) &&
      await shell.getByText('Método: Efectivo').isVisible()) {
    await shell.getByRole('button', { name: 'Anterior' }).click();
  }
  await methodHeading.waitFor({ timeout: 10_000 });
  const codMethod = shell.locator('app-payment-collector .payment-method-btn')
    .filter({ hasText: 'Pago Contra Entrega' });
  await codMethod.waitFor();
  // The collector rebuilds its method grid once the async store methods land;
  // a click on the first DOM incarnation can detach before Playwright acts.
  for (let attempt = 0; attempt < 4; attempt++) {
    if (await shell.getByText('Método: Pago Contra Entrega').isVisible()) break;
    try {
      await codMethod.click({ timeout: 5_000 });
      await shell.getByText('Método: Pago Contra Entrega').waitFor({ timeout: 5_000 });
      break;
    } catch (error) {
      if (attempt === 3) {
        throw new Error(`COD method could not be selected: ${String(error?.message ?? error).slice(0, 100)}; UI=${(await shell.innerText()).slice(0, 550)}`);
      }
    }
  }
  await shell.getByText('Método: Pago Contra Entrega').waitFor();
  await shell.locator('button.btn-confirm').filter({ hasText: 'Finalizar venta' }).click();
  await page.getByText('¡Pedido con Envío!', { exact: true }).waitFor({ timeout: 25_000 });
  const receipt = await page.locator('app-pos-order-confirmation').innerText();
  const orderNumber = receipt.match(/POS-\d{4}-\d+/)?.[0];
  assert(orderNumber, 'The COD receipt lacks an order number.');
  assert.match(receipt, /Pago Contra Entrega:[\s\S]*\$43\.000/);
  process.stdout.write(`COD receipt ${orderNumber} created via UI for ${alias}.\n`);
  const detailButton = page.locator(
    'app-pos-order-confirmation app-button[title="Ver detalle de la orden"] button',
  );
  for (let attempt = 0; attempt < 3; attempt++) {
    await detailButton.click();
    try {
      await page.waitForURL(/\/admin\/orders\/\d+/, {
        waitUntil: 'commit', timeout: 6_000,
      });
      break;
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
  const orderId = Number(page.url().match(/\/admin\/orders\/(\d+)/)?.[1]);
  assert(Number.isSafeInteger(orderId) && orderId > 0);
  await openView(page, `${BASE}/admin/orders/${orderId}`,
    page.getByRole('heading', { name: `Orden #${orderNumber}` }),
    `New COD ${orderNumber} detail`);
  const history = page.getByRole('heading', { name: /Historial de Pagos/i })
    .locator('xpath=..');
  assert.match(await history.innerText(), /\$43\.000[\s\S]*PENDIENTE[\s\S]*Pago Contra Entrega/);
  assert.equal(await page.getByRole('button', { name: 'Confirmar Pago' }).count(), 1);
  return { alias, orderId, orderNumber };
}

async function resumePendingCodOrder(page) {
  assert.equal(process.env.QA_COD_RACE_RESUME, '1');
  const orderId = Number(process.env.QA_COD_RACE_ORDER_ID);
  const orderNumber = process.env.QA_COD_RACE_ORDER_NUMBER;
  assert(Number.isSafeInteger(orderId) && orderId > 0);
  assert(/^POS-\d{4}-\d+$/.test(orderNumber || ''));
  await openView(page, `${BASE}/admin/orders/${orderId}`,
    page.getByRole('heading', { name: `Orden #${orderNumber}` }),
    `Resume pending COD ${orderNumber}`);
  const history = page.getByRole('heading', { name: /Historial de Pagos/i })
    .locator('xpath=..');
  const text = await history.innerText();
  assert.match(text, /\$43\.000[\s\S]*PENDIENTE[\s\S]*Pago Contra Entrega/);
  assert(!text.includes('EXITOSO'), 'Resume is only safe before any successful payment.');
  assert.equal(await page.getByRole('button', { name: 'Confirmar Pago' }).count(), 1);
  return { alias: 'existing UI-verified COD fixture', orderId, orderNumber };
}

async function openTender(page, fixture, method) {
  await openView(page, `${BASE}/admin/orders/${fixture.orderId}`,
    page.getByRole('heading', { name: `Orden #${fixture.orderNumber}` }),
    `COD ${fixture.orderNumber}`);
  await page.getByRole('button', { name: 'Confirmar Pago' }).first().click();
  const modal = page.getByRole('dialog');
  await modal.getByText(method, { exact: true }).waitFor({ timeout: 20_000 });
  await modal.getByText(method, { exact: true }).click();
  assert.equal(await modal.locator('.payment-method-btn.selected').innerText(), method);
  assert(await modal.getByRole('button', { name: 'Confirmar Pago' }).isEnabled());
  return modal;
}

async function run() {
  assert.equal(process.env.QA_COD_RACE_RUN, '1',
    'Set QA_COD_RACE_RUN=1 to create a fresh COD order through the local UI.');
  assert(process.env.QA_EMAIL && process.env.QA_PASSWORD,
    'QA_EMAIL and QA_PASSWORD must be supplied in the process environment.');
  let firstBrowser;
  let secondBrowser;
  let fixture;
  try {
    firstBrowser = await chromium.launch({ channel: 'chrome', headless: true });
    const firstContext = await firstBrowser.newContext({ ignoreHTTPSErrors: true });
    const first = await firstContext.newPage();
    await login(first);
    fixture = process.env.QA_COD_RACE_RESUME === '1'
      ? await resumePendingCodOrder(first)
      : await createCodOrder(first);
    process.stdout.write(`COD fixture ${fixture.orderNumber} (#${fixture.orderId}) verified pending via UI.\n`);

    // A separate Chromium process avoids the local admin SSE connection pool
    // starving the second tab's payment-method request. Auth stays in memory.
    secondBrowser = await chromium.launch({ channel: 'chrome', headless: true });
    const secondContext = await secondBrowser.newContext({
      ignoreHTTPSErrors: true,
      storageState: await firstContext.storageState(),
    });
    const second = await secondContext.newPage();
    const firstModal = await openTender(first, fixture, 'Efectivo');
    const secondModal = await openTender(second, fixture, 'Datáfono');
    const urlPart = `/orders/${fixture.orderId}/flow/pay`;
    const firstResponse = first.waitForResponse((response) =>
      response.url().includes(urlPart) && response.request().method() === 'POST');
    const secondResponse = second.waitForResponse((response) =>
      response.url().includes(urlPart) && response.request().method() === 'POST');
    await Promise.all([
      firstModal.getByRole('button', { name: 'Confirmar Pago' }).click(),
      secondModal.getByRole('button', { name: 'Confirmar Pago' }).click(),
    ]);
    const [firstStatus, secondStatus] = await Promise.all([
      firstResponse.then((response) => response.status()),
      secondResponse.then((response) => response.status()),
    ]);
    assert.deepEqual([firstStatus, secondStatus].sort(), [200, 409],
      'Concurrent UI submits must yield exactly one accepted payment.');
    const winner = firstStatus === 200 ? first : second;
    const loser = firstStatus === 409 ? first : second;
    const actualMethod = firstStatus === 200 ? 'Efectivo' : 'Datáfono';
    const staleModal = loser.getByRole('dialog');
    if (await staleModal.isVisible()) {
      const retryResponse = loser.waitForResponse((response) =>
        response.url().includes(urlPart) && response.request().method() === 'POST');
      await staleModal.getByRole('button', { name: 'Confirmar Pago' }).click();
      assert.equal((await retryResponse).status(), 409);
      await loser.getByText(/Esta orden ya está pagada por completo/)
        .waitFor({ timeout: 10_000 });
      await staleModal.getByRole('button', { name: 'Cancelar' }).click();
    }

    await openView(winner, `${BASE}/admin/orders/${fixture.orderId}`,
      winner.getByRole('heading', { name: `Orden #${fixture.orderNumber}` }),
      'Settled COD after concurrent submits');
    const history = winner.getByRole('heading', { name: /Historial de Pagos/i })
      .locator('xpath=..');
    await history.getByText(actualMethod, { exact: true }).waitFor();
    assert.equal(await history.locator(':scope > div').count(), 2,
      'Race must leave one COD marker and exactly one successful tender.');
    const text = (await history.innerText()).toLowerCase();
    assert.match(text, /\$43\.000[\s\S]*cancelado[\s\S]*pago contra entrega/);
    assert(text.includes('exitoso') && text.includes(actualMethod.toLowerCase()));
    assert.equal(await winner.getByRole('button', { name: 'Confirmar Pago' }).count(), 0);
    process.stdout.write(`PASS R20 COD concurrent UI: one ${actualMethod} payment, one rejected attempt, marker retained after reload.\n`);
  } finally {
    if (secondBrowser) await secondBrowser.close();
    if (firstBrowser) await firstBrowser.close();
    if (fixture) process.stdout.write(`Fixture: ${fixture.orderNumber} (#${fixture.orderId}), alias ${fixture.alias}.\n`);
  }
}

run().catch((error) => {
  process.stderr.write(`FAIL R20 COD concurrent UI: ${String(error?.stack ?? error).slice(0, 1800)}\n`);
  process.exitCode = 1;
});
