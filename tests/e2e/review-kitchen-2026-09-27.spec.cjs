/*
 * Review R6/R18 — browser-only, deliberately fixture-gated E2E.
 *
 * This is NOT a self-seeding suite. Fresh orders/tickets must first be made
 * through the local UI, in the same Roku restaurant store and current KDS
 * business day. Reusing a cancelled ticket would make a false green test.
 * No direct API calls, DB writes, saved browser state, or embedded credentials.
 *
 * Required environment:
 *   QA_EMAIL, QA_PASSWORD
 *   QA_KITCHEN_FIXTURES = JSON with:
 *     r6: { orderId, orderNumber, directName, dishName }
 *       Fresh home-delivery COD/credit order, direct item + fired dish; dish
 *       KDS ticket pending, both items not delivered, order not dispatched.
 *     pending: { orderNumber, dishName, ingredients: [{productId, quantity}] }
 *       Fresh, one-dish pending KDS ticket with active recipe; ingredient
 *       quantities are the real recipe stock units consumed at fire.
 *     reuse: { orderNumber, dishName, ingredients: [...] }
 *     waste: { orderNumber, dishName, ingredients: [...] }
 *       Fresh, one-dish in_preparation KDS tickets with the same recipe rule.
 *       Each orderNumber must be unique; tickets should not share an order.
 *
 * Keep an OWN KDS station shift open in the browser account before running.
 * Use isolated ingredients/stock during the run; no concurrent sales/adjustments.
 * Run only against local dev, never production:
 *   NODE_PATH=/opt/homebrew/lib/node_modules node tests/e2e/review-kitchen-2026-09-27.spec.cjs
 *
 * A missing fixture or UI precondition FAILS. This file does not claim PASS
 * until the browser actually executes all assertions.
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const BASE = process.env.QA_BASE_URL || 'https://vendix.com';
const results = [];
const observedCancelResponses = [];

function parseFixtures() {
  assert(process.env.QA_EMAIL && process.env.QA_PASSWORD,
    'QA_EMAIL and QA_PASSWORD must be supplied in the process environment.');
  assert(process.env.QA_KITCHEN_FIXTURES,
    'QA_KITCHEN_FIXTURES is required; fresh UI-created R6/pending/reuse/waste fixtures are not optional.');
  const fixtures = JSON.parse(process.env.QA_KITCHEN_FIXTURES);
  const orderNumbers = [];
  for (const key of ['r6', 'pending', 'reuse', 'waste']) {
    const row = fixtures[key];
    assert(row && typeof row.orderNumber === 'string' && /^POS-\d{4}-\d+$/.test(row.orderNumber),
      `${key}.orderNumber must be the UI-visible POS order number.`);
    assert(typeof row.dishName === 'string' && row.dishName.trim(),
      `${key}.dishName must be the exact UI-visible prepared product name.`);
    orderNumbers.push(row.orderNumber);
    if (key === 'r6') {
      assert(Number.isSafeInteger(row.orderId) && row.orderId > 0, 'r6.orderId is required.');
      assert(typeof row.directName === 'string' && row.directName.trim(),
        'r6.directName is required.');
      assert.notEqual(row.directName, row.dishName);
    } else {
      assert(Array.isArray(row.ingredients) && row.ingredients.length,
        `${key}.ingredients must enumerate the active recipe's tracked ingredients.`);
      for (const ingredient of row.ingredients) {
        assert(Number.isSafeInteger(ingredient.productId) && ingredient.productId > 0,
          `${key}: ingredient productId must be a positive integer.`);
        assert(Number.isSafeInteger(ingredient.quantity) && ingredient.quantity > 0,
          `${key}: ingredient quantity must be a positive integer stock-unit count.`);
      }
    }
  }
  assert.equal(new Set(orderNumbers).size, 4,
    'All four fixture orders must be distinct to avoid cross-scenario mutation.');
  return fixtures;
}

async function openView(page, url, ready, label) {
  let last = '';
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'commit', timeout: 25_000 });
      await ready.waitFor({ timeout: 15_000 });
      return;
    } catch (error) {
      last = `${String(error?.message ?? error).slice(0, 180)}; url=${page.url()}; ` +
        `ui=${(await page.locator('body').innerText().catch(() => '')).slice(-180)}`;
      if (attempt < 4) await page.goto('about:blank', { waitUntil: 'commit' }).catch(() => {});
    }
  }
  throw new Error(`${label} did not render via UI at ${page.url()}: ${last}`);
}

async function login(page) {
  await openView(page, `${BASE}/auth/login`, page.locator('input[type=email]'), 'Login');
  // SSR can show the form before Angular attaches its submit handler.
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
    'POS admin');
  const storyClose = page.getByRole('button', { name: 'Cerrar Tu semana en Vendix' });
  if (await storyClose.isVisible()) await storyClose.click();
}

async function openKds(page) {
  await openView(page, `${BASE}/admin/restaurant-ops/kds`,
    page.getByRole('heading', { name: 'KDS — Pantalla de Cocina' }), 'KDS');
  await page.locator('.kds-board__loading').waitFor({ state: 'hidden', timeout: 20_000 });
  const picker = page.locator('.kds-station-picker');
  await page.waitForFunction(() =>
    Boolean(document.querySelector('.kds-station-picker')?.getClientRects().length) ||
    Boolean(document.querySelector('section.kds-column[data-column="pending"]')?.getClientRects().length),
  null, { timeout: 15_000 });
  if (await picker.isVisible()) {
    const station = process.env.QA_KDS_STATION_NAME || 'Cocina';
    await picker.getByRole('button').filter({ hasText: station }).click();
    await picker.waitFor({ state: 'hidden' });
  }
  await page.locator('section.kds-column[data-column=pending]').waitFor();
}

function ticketCard(page, column, fixture) {
  // The card exposes the order number even when the visible ticket number is
  // its daily_number rather than its database id. No invisible DB coupling.
  return page.locator(`section.kds-column[data-column="${column}"] app-kds-ticket-card`)
    .filter({ hasText: `Orden ${fixture.orderNumber}` })
    .filter({ hasText: fixture.dishName });
}

async function requireTicket(page, column, fixture) {
  const card = ticketCard(page, column, fixture);
  try {
    await card.waitFor({ timeout: 15_000 });
  } catch {
    const currentColumn = await page.locator(`section.kds-column[data-column="${column}"]`)
      .innerText().catch(() => '(column not rendered)');
    throw new Error(`${fixture.orderNumber} did not appear in ${column}; ` +
      `url=${page.url()}; ui=${currentColumn.slice(-250)}; ` +
      `body=${(await page.locator('body').innerText()).slice(-230)}; ` +
      `post=${JSON.stringify(observedCancelResponses.slice(-2))}`);
  }
  assert.equal(await card.count(), 1,
    `Expected one ${column} KDS card for ${fixture.orderNumber}/${fixture.dishName}.`);
  return card;
}

async function requireOwnKdsShift(page) {
  const own = page.locator('app-kds-session-status-bar [aria-label="Cerrar mi turno"]');
  await own.waitFor({ state: 'visible', timeout: 12_000 }).catch(async () => {
    throw new Error('The QA account must open its OWN KDS station shift through the UI before mutating tickets. ' +
      (await page.locator('app-kds-session-status-bar').innerText()).slice(0, 220));
  });
}

async function readAvailableStock(page, productId) {
  const stat = page.locator('app-stats').filter({ hasText: 'Disponible en esta tienda' });
  await openView(page, `${BASE}/admin/inventory/stock/${productId}`,
    stat.locator('.stat-value'), `Stock ${productId}`);
  const raw = (await stat.locator('.stat-value').innerText()).trim();
  const normalized = raw.replace(/[.\s\u00a0]/g, '').replace(',', '.');
  const number = Number(normalized);
  assert(Number.isFinite(number), `Stock UI has an unparsable availability value: ${raw}`);
  return number;
}

async function snapshotStock(page, fixture) {
  const values = new Map();
  for (const ingredient of fixture.ingredients) {
    values.set(ingredient.productId, await readAvailableStock(page, ingredient.productId));
  }
  return values;
}

async function assertStockDelta(page, fixture, before, expectedMultiplier) {
  for (const ingredient of fixture.ingredients) {
    const expected = before.get(ingredient.productId) + ingredient.quantity * expectedMultiplier;
    let observed;
    for (let retry = 0; retry < 4; retry++) {
      observed = await readAvailableStock(page, ingredient.productId);
      if (observed === expected) break;
      await page.waitForTimeout(750);
    }
    assert.equal(observed, expected,
      `${fixture.orderNumber}: ingredient ${ingredient.productId} must change by ` +
      `${ingredient.quantity * expectedMultiplier}, not ${observed - before.get(ingredient.productId)}.`);
  }
}

async function run(name, reviewId, scheme, fn) {
  const started = Date.now();
  try {
    const evidence = await fn();
    results.push({ name, reviewId, scheme, status: 'passed', evidence, ms: Date.now() - started });
    process.stdout.write(`PASS ${reviewId} ${scheme}: ${evidence}\n`);
  } catch (error) {
    const message = String(error?.message ?? error).slice(0, 1_800);
    results.push({ name, reviewId, scheme, status: 'failed', evidence: message, ms: Date.now() - started });
    process.stderr.write(`FAIL ${reviewId} ${scheme}: ${message}\n`);
    // Mutating flows must stop after an unexpected state; later assertions
    // could silently operate on a different/partially changed fixture.
    throw error;
  }
}

async function main() {
  const fixtures = parseFixtures(); // Fail before opening a browser or mutating anything.
  const group = process.env.QA_KITCHEN_GROUP || 'all';
  assert(['all', 'r6', 'r6_handoff', 'r6_dispatch', 'r18', 'pending', 'reuse', 'waste'].includes(group),
    'QA_KITCHEN_GROUP must be all, r6, r6_handoff, r6_dispatch, r18, pending, reuse or waste.');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const admin = await context.newPage();
  // One tab avoids the local vhost resetting KDS station selection while a
  // second tab loads inventory. Each scenario navigates UI between surfaces.
  const kds = admin;
  kds.on('response', async (response) => {
    if (response.request().method() !== 'POST' ||
        !/\/kitchen-fire\/tickets\/\d+\/cancel$/.test(new URL(response.url()).pathname)) return;
    try {
      const body = await response.json();
      observedCancelResponses.push({
        http: response.status(), id: body?.data?.id ?? null,
        status: body?.data?.status ?? null,
        orderNumber: body?.data?.order?.order_number ?? null,
      });
    } catch {
      observedCancelResponses.push({ http: response.status(), unreadable: true });
    }
  });
  const stock = admin;
  admin.setDefaultTimeout(15_000);
  try {
    await login(admin);

    if (group === 'all' || group === 'r6') await run('Mixed direct + prepared item cannot dispatch past pending KDS', 'R6', 'sad/integrity', async () => {
      const fixture = fixtures.r6;
      await openView(admin, `${BASE}/admin/orders/${fixture.orderId}`,
        admin.getByRole('heading', { name: `Orden #${fixture.orderNumber}` }), 'R6 order detail');
      assert((await admin.locator('body').innerText()).includes(fixture.orderNumber),
        `Order ID ${fixture.orderId} does not display ${fixture.orderNumber}; wrong fixture.`);
      const items = admin.locator('.items-compact > div');
      const direct = items.filter({ hasText: fixture.directName });
      const dish = items.filter({ hasText: fixture.dishName });
      assert.equal(await direct.count(), 1, 'Direct item must appear exactly once.');
      assert.equal(await dish.count(), 1, 'Prepared dish must appear exactly once.');
      await admin.getByText(/plato\(s\) pendientes de cocina/).waitFor();
      assert.equal(await dish.getByRole('button', { name: 'Entregar', exact: true }).count(), 0,
        'Pending prepared dish must not offer individual delivery.');
      // A disabled app-button sets aria-label to the blocking reason; the
      // visible text still says Despachar Orden but its accessible name does
      // not. Select the visible wrapper and inspect its native button.
      const dispatch = admin.locator('app-button:visible')
        .filter({ hasText: 'Despachar Orden' }).locator('button');
      assert.equal(await dispatch.count(), 1, 'Exactly one dispatch action should be projected.');
      assert(await dispatch.isDisabled(), 'Whole-order dispatch must remain disabled while dish is pending.');
      await direct.getByRole('button', { name: 'Entregar', exact: true }).click();
      await direct.getByText('Entregado', { exact: true }).waitFor();
      await admin.reload({ waitUntil: 'commit' });
      await admin.getByRole('heading', { name: `Orden #${fixture.orderNumber}` }).waitFor();
      const after = admin.locator('.items-compact > div');
      await after.filter({ hasText: fixture.directName })
        .getByText('Entregado', { exact: true }).waitFor();
      const dishAfter = after.filter({ hasText: fixture.dishName });
      assert.equal(await dishAfter.getByText('Entregado', { exact: true }).count(), 0,
        'Delivering direct item must not mark the dish delivered after reload.');
      await openKds(kds);
      await requireTicket(kds, 'pending', fixture);
      return `${fixture.orderNumber}: direct delivered; dish/KDS remained pending; dispatch disabled after reload`;
    });

    if (group === 'r6_handoff') await run('Prepared dish handoff unblocks whole-order dispatch', 'R6', 'happy/integrity', async () => {
      const fixture = fixtures.r6;
      await openKds(kds);
      await requireOwnKdsShift(kds);
      let card = await requireTicket(kds, 'pending', fixture);
      await card.getByRole('button', { name: 'Iniciar', exact: true }).click();
      await kds.getByRole('dialog', { name: 'Verificar ticket para cocinar' })
        .getByRole('button', { name: 'Cocinar sin cambios' }).click();
      card = await requireTicket(kds, 'in_preparation', fixture);
      await card.getByRole('button', { name: 'Listo', exact: true }).click();
      card = await requireTicket(kds, 'ready', fixture);
      await card.getByRole('button', { name: 'Entregar', exact: true }).click();
      await requireTicket(kds, 'delivered', fixture);

      await openView(admin, `${BASE}/admin/orders/${fixture.orderId}`,
        admin.getByRole('heading', { name: `Orden #${fixture.orderNumber}` }), 'R6 ready order detail');
      const dish = admin.locator('.items-compact > div').filter({ hasText: fixture.dishName });
      await dish.waitFor();
      assert(!(await dish.innerText()).includes('Cocina: Pendiente'),
        'The delivered kitchen ticket still looks pending in the order detail.');
      const dispatch = admin.locator('app-button:visible')
        .filter({ hasText: 'Despachar Orden' }).locator('button');
      assert.equal(await dispatch.count(), 1, 'One dispatch action should remain after handoff.');
      assert(await dispatch.isEnabled(), 'Dispatch must unlock after KDS delivered the dish.');
      return `${fixture.orderNumber}: KDS pending→preparing→ready→delivered; dispatch enabled in order detail`;
    });

    if (group === 'r6_dispatch') await run('Dispatch after kitchen handoff preserves COD payment pending', 'R6', 'happy/sad', async () => {
      const fixture = fixtures.r6;
      await openKds(kds);
      await requireTicket(kds, 'delivered', fixture);
      await openView(admin, `${BASE}/admin/orders/${fixture.orderId}`,
        admin.getByRole('heading', { name: `Orden #${fixture.orderNumber}` }), 'R6 dispatch order');
      const dispatch = admin.locator('app-button:visible')
        .filter({ hasText: 'Despachar Orden' }).locator('button');
      assert.equal(await dispatch.count(), 1, 'Only one dispatch CTA should remain after kitchen handoff.');
      assert(await dispatch.isEnabled(), 'Dispatch must be enabled after KDS delivered the dish.');
      await dispatch.click();
      const courier = admin.locator('app-courier-name-modal');
      await courier.getByText('¿Quién lleva el despacho?').waitFor();
      await courier.getByRole('button', { name: 'Cancelar' }).click();
      assert(await dispatch.isEnabled(), 'Abandoning courier selection must not dispatch the order.');
      await dispatch.click();
      await courier.locator('app-input[formcontrolname="courier_name"] input')
        .fill('QA Review R6 Repartidor');
      await courier.getByRole('button', { name: 'Confirmar entrega' }).click();
      await admin.locator('app-sticky-header').getByText('Entregada', { exact: true })
        .waitFor({ timeout: 25_000 });
      await openView(admin, `${BASE}/admin/orders/${fixture.orderId}`,
        admin.getByRole('heading', { name: `Orden #${fixture.orderNumber}` }), 'R6 dispatched reload');
      const body = await admin.locator('body').innerText();
      assert(body.includes('PENDIENTE') && body.includes('Pago Contra Entrega'),
        'Kitchen handoff/dispatch must not silently collect the COD payment.');
      assert.equal(await admin.locator('app-button:visible')
        .filter({ hasText: 'Despachar Orden' }).count(), 0,
      'Delivered order must not offer a second dispatch.');
      return `${fixture.orderNumber}: courier cancel was safe; delivery completed after KDS, COD still pending after reload`;
    });

    if (['all', 'r18', 'pending'].includes(group)) await run('Pending KDS cancellation automatically restores each ingredient once', 'R18', 'happy/integrity', async () => {
      const fixture = fixtures.pending;
      await openKds(kds);
      await requireOwnKdsShift(kds);
      await requireTicket(kds, 'pending', fixture);
      const before = await snapshotStock(stock, fixture);
      await openKds(kds);
      await requireOwnKdsShift(kds);
      const card = await requireTicket(kds, 'pending', fixture);
      await card.getByRole('button', { name: 'Cancelar', exact: true }).click();
      const dialog = kds.getByRole('dialog', { name: 'Cancelar ticket' });
      await dialog.getByText(/insumos se reintegrarán automáticamente/).waitFor();
      assert.equal(await kds.getByRole('dialog', { name: 'Cancelar plato en preparación' }).count(), 0,
        'Pending ticket must not ask for waste/reuse.');
      await dialog.getByRole('button', { name: 'Cancelar ticket' }).click();
      await requireTicket(kds, 'cancelled', fixture);
      await assertStockDelta(stock, fixture, before, 1);
      await openKds(kds);
      await requireTicket(kds, 'cancelled', fixture);
      assert.equal(await ticketCard(kds, 'pending', fixture).count(), 0,
        'Cancelled ticket must not return to pending or offer a second cancellation.');
      await assertStockDelta(stock, fixture, before, 1);
      return `${fixture.orderNumber}: automatic +recipe stock, cancelled after reload, no second reintegration`;
    });

    if (['all', 'r18', 'reuse'].includes(group)) await run('Advanced cancellation can be abandoned; reuse restores stock only once', 'R18', 'sad/integrity', async () => {
      const fixture = fixtures.reuse;
      await openKds(kds);
      await requireOwnKdsShift(kds);
      await requireTicket(kds, 'in_preparation', fixture);
      const before = await snapshotStock(stock, fixture);
      await openKds(kds);
      await requireOwnKdsShift(kds);
      let card = await requireTicket(kds, 'in_preparation', fixture);
      await card.getByRole('button', { name: 'Cancelar', exact: true }).click();
      let dialog = kds.getByRole('dialog', { name: 'Cancelar plato en preparación' });
      await dialog.getByRole('button', { name: 'Volver' }).click();
      await requireTicket(kds, 'in_preparation', fixture);
      await assertStockDelta(stock, fixture, before, 0);
      await openKds(kds);
      card = await requireTicket(kds, 'in_preparation', fixture);
      await card.getByRole('button', { name: 'Cancelar', exact: true }).click();
      dialog = kds.getByRole('dialog', { name: 'Cancelar plato en preparación' });
      await dialog.getByRole('button', { name: 'Reutilizar y reintegrar' }).click();
      await requireTicket(kds, 'cancelled', fixture);
      await assertStockDelta(stock, fixture, before, 1);
      await openKds(kds);
      await requireTicket(kds, 'cancelled', fixture);
      await assertStockDelta(stock, fixture, before, 1);
      return `${fixture.orderNumber}: Volver left stock/state intact; reuse restored once`;
    });

    if (['all', 'r18', 'waste'].includes(group)) await run('Advanced waste records cancellation without returning ingredient stock', 'R18', 'happy/integrity', async () => {
      const fixture = fixtures.waste;
      await openKds(kds);
      await requireOwnKdsShift(kds);
      await requireTicket(kds, 'in_preparation', fixture);
      const before = await snapshotStock(stock, fixture);
      await openKds(kds);
      await requireOwnKdsShift(kds);
      const card = await requireTicket(kds, 'in_preparation', fixture);
      await card.getByRole('button', { name: 'Cancelar', exact: true }).click();
      const dialog = kds.getByRole('dialog', { name: 'Cancelar plato en preparación' });
      await dialog.getByRole('button', { name: 'Desechar insumos' }).click();
      await requireTicket(kds, 'cancelled', fixture);
      await assertStockDelta(stock, fixture, before, 0);
      await openKds(kds);
      await requireTicket(kds, 'cancelled', fixture);
      await assertStockDelta(stock, fixture, before, 0);
      return `${fixture.orderNumber}: waste left ingredient stock unchanged after reload`;
    });
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  process.stderr.write(`KITCHEN E2E INCOMPLETE: ${String(error?.message ?? error).slice(0, 900)}\n`);
  process.exitCode = 1;
}).finally(() => {
  process.stdout.write(`Coverage: ${results.length} executed; ${results.filter((r) => r.status === 'passed').length} passed; ` +
    'R6 skipKds-with-existing-ticket and R18 item/order cancellation remain outside this fixture-gated file.\n');
});
