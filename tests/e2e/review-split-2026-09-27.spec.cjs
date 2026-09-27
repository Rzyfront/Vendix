/*
 * R12 — UI-only financial split E2E. Deliberately fixture-gated: creating a
 * restaurant table/order needs a real POS sale, stocked items and a chosen
 * table, so this runner will NOT improvise or reuse a paid session.
 *
 * Prepare three DISTINCT, fresh, unsplit local-dev orders THROUGH THE UI:
 *  - table: open four-guest table session with an unpaid order;
 *  - detail: unpaid order eligible for split in /admin/orders/:id;
 *  - taxedShipping: unpaid order with a taxed shipping charge. taxCents is
 *    merchandise tax shown in split accounts; shippingTaxCents is the
 *    separate shipping-tax snapshot shown on the source order detail.
 * No order may have a pending payment, invoice, refund or financial split.
 * Use four unique aliases per fixture and record the visible order number.
 * All amounts below are integer cents, never formatted text.
 *
 * QA_EMAIL=... QA_PASSWORD=... QA_SPLIT_ALLOW_MUTATION=1 \
 * QA_SPLIT_FIXTURES='{"table":{"sessionId":...,"orderId":...,"orderNumber":"...","tableLabel":"...","totalCents":...,"partialFirstCents":...,"aliases":["...","...","...","..."]},"detail":{"orderId":...,"orderNumber":"...","totalCents":...,"aliases":["...","...","...","..."]},"taxedShipping":{"orderId":...,"orderNumber":"...","totalCents":...,"taxCents":...,"shippingCents":...,"shippingTaxCents":...,"aliases":["...","...","...","..."]}}' \
 * NODE_PATH=/opt/homebrew/lib/node_modules node tests/e2e/review-split-2026-09-27.spec.cjs
 *
 * Never run against production. No direct API requests, DB writes, saved
 * browser state, credentials in source, or PASS before browser assertions.
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const BASE = process.env.QA_BASE_URL || 'https://vendix.com';
const results = [];

function fixtureGate() {
  const base = new URL(BASE);
  assert.equal(base.protocol, 'https:', 'QA_BASE_URL must be HTTPS local Vendix vhost.');
  assert(base.hostname === 'vendix.com' || base.hostname.endsWith('.vendix.com'),
    'R12 E2E refuses any hostname outside local *.vendix.com.');
  assert.equal(process.env.QA_SPLIT_ALLOW_MUTATION, '1',
    'Set QA_SPLIT_ALLOW_MUTATION=1 only after preparing three fresh UI-created local fixtures.');
  assert(process.env.QA_EMAIL && process.env.QA_PASSWORD,
    'QA_EMAIL and QA_PASSWORD are required in the process environment.');
  assert(process.env.QA_SPLIT_FIXTURES,
    'QA_SPLIT_FIXTURES JSON is required; this suite never reuses old or guessed orders.');
  const data = JSON.parse(process.env.QA_SPLIT_FIXTURES);
  const ids = [];
  for (const key of ['table', 'detail', 'taxedShipping']) {
    const row = data[key];
    assert(row && Number.isSafeInteger(row.orderId) && row.orderId > 0,
      `${key}.orderId must identify a fresh UI-created order.`);
    assert(typeof row.orderNumber === 'string' && /^[A-Z0-9][A-Z0-9-]{3,}$/.test(row.orderNumber),
      `${key}.orderNumber must match the visible order code.`);
    assert(Number.isSafeInteger(row.totalCents) && row.totalCents > 0,
      `${key}.totalCents must be a positive integer.`);
    assert(Array.isArray(row.aliases) && row.aliases.length === 4 &&
      row.aliases.every((alias) => typeof alias === 'string' && alias.trim().length >= 4) &&
      new Set(row.aliases).size === 4,
      `${key}.aliases must contain four distinct names of at least four characters.`);
    ids.push(row.orderId);
  }
  assert.equal(new Set(ids).size, 3, 'Table/detail/taxedShipping orders must be distinct.');
  assert(Number.isSafeInteger(data.table.sessionId) && data.table.sessionId > 0,
    'table.sessionId must identify an OPEN UI-created table session.');
  assert(typeof data.table.tableLabel === 'string' && data.table.tableLabel.trim(),
    'table.tableLabel must be the visible table name.');
  assert(Number.isSafeInteger(data.table.partialFirstCents) &&
    data.table.partialFirstCents > 0 &&
    data.table.partialFirstCents < Math.floor(data.table.totalCents / 4),
    'table.partialFirstCents must be a positive partial abono smaller than one quarter.');
  assert(Number.isSafeInteger(data.taxedShipping.taxCents) && data.taxedShipping.taxCents >= 0,
    'taxedShipping.taxCents must be merchandise tax in nonnegative integer cents.');
  for (const field of ['shippingCents', 'shippingTaxCents']) {
    assert(Number.isSafeInteger(data.taxedShipping[field]) && data.taxedShipping[field] > 0,
      `taxedShipping.${field} must be a positive integer-cent amount.`);
  }
  return data;
}

function cents(text) {
  let raw = String(text).replace(/[^\d.,-]/g, '');
  assert(raw, `Cannot parse money from UI: ${text}`);
  const comma = raw.lastIndexOf(',');
  const dot = raw.lastIndexOf('.');
  const separator = Math.max(comma, dot);
  if (separator >= 0 && raw.length - separator - 1 === 2) {
    const integer = raw.slice(0, separator).replace(/[.,]/g, '');
    raw = `${integer}.${raw.slice(separator + 1)}`;
  } else {
    raw = raw.replace(/[.,]/g, '');
  }
  const result = Math.round(Number(raw) * 100);
  assert(Number.isSafeInteger(result), `UI money is not a finite cent value: ${text}`);
  return result;
}

async function openUi(page, url, ready, label) {
  let last = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'commit', timeout: 25_000 });
      await ready.waitFor({ timeout: 15_000 });
      return;
    } catch (error) {
      last = String(error?.message ?? error).slice(0, 180);
      await page.goto('about:blank', { waitUntil: 'commit' }).catch(() => {});
    }
  }
  throw new Error(`${label} did not render through UI at ${url}: ${last}`);
}

async function login(page) {
  await openUi(page, `${BASE}/auth/login`, page.locator('input[type=email]'), 'Login');
  await page.waitForTimeout(900); // SSR can precede Angular submit hydration.
  if (process.env.QA_ORG_SLUG || process.env.QA_STORE_SLUG) {
    await page.getByRole('button', { name: 'Seleccionar comercio (opcional)' }).click();
    if (process.env.QA_ORG_SLUG) await page.getByRole('button', { name: 'Organización' }).click();
    await page.locator('input[placeholder="Nombre o ID del comercio"]')
      .fill(process.env.QA_ORG_SLUG || process.env.QA_STORE_SLUG);
    await page.getByRole('button', { name: 'Confirmar' }).click();
  }
  if (await page.getByText('Demasiados intentos de inicio de sesión').isVisible()) {
    throw new Error('QA login is rate-limited in the UI. Wait for expiry; do not retry now.');
  }
  await page.locator('input[type=email]').fill(process.env.QA_EMAIL);
  await page.locator('input[type=password]').fill(process.env.QA_PASSWORD);
  await page.getByRole('button', { name: 'Iniciar Sesión' }).click();
  await page.waitForFunction(() => {
    try {
      const state = JSON.parse(localStorage.getItem('vendix_auth_state') || '{}');
      return Boolean(state?.tokens?.access_token && state?.user?.id);
    } catch { return false; }
  }, null, { timeout: 20_000 });
  await openUi(page, `${BASE}/admin/pos`, page.getByText('Carrito Actual', { exact: true }), 'POS after login');
  const storyClose = page.getByRole('button', { name: 'Cerrar Tu semana en Vendix' });
  if (await storyClose.isVisible()) await storyClose.click();
}

async function run(name, scheme, fn) {
  const started = Date.now();
  try {
    const evidence = await fn();
    results.push({ reviewId: 'R12', name, scheme, status: 'passed', evidence, ms: Date.now() - started });
    process.stdout.write(`PASS R12 ${scheme}: ${evidence}\n`);
  } catch (error) {
    const evidence = String(error?.message ?? error).slice(0, 1000);
    results.push({ reviewId: 'R12', name, scheme, status: 'failed', evidence, ms: Date.now() - started });
    process.stderr.write(`FAIL R12 ${scheme}: ${evidence}\n`);
    throw error; // Never mutate the next fixture after an uncertain failure.
  }
}

async function openTable(page, fixture) {
  // Table page does not render order_number. Verify the declared order and
  // unique table name in its detail first, then return to the table session.
  await openUi(page, `${BASE}/admin/orders/${fixture.orderId}`,
    page.getByRole('heading', { name: `Orden #${fixture.orderNumber}` }), 'Table source order');
  assert((await page.locator('body').innerText()).includes(fixture.tableLabel),
    `Order ${fixture.orderNumber} does not belong to ${fixture.tableLabel}.`);
  await openUi(page, `${BASE}/admin/restaurant-ops/tables/session/${fixture.sessionId}`,
    page.getByText(`Sesión #${fixture.sessionId}`, { exact: false }).first(), 'Open table');
  const body = await page.locator('body').innerText();
  assert(body.includes(fixture.tableLabel), `Session ${fixture.sessionId} is not ${fixture.tableLabel}.`);
  assert(body.includes('Cuenta abierta'), 'Table fixture is closed; use a fresh open session.');
  const panel = page.locator('app-split-accounts-panel section.split-panel').first();
  assert.equal(await panel.getByRole('heading', { name: 'Cuentas creadas' }).count(), 0,
    'Table already has financial accounts; refusing to reuse a stale fixture.');
  assert.equal(await panel.locator('small').filter({ hasText: /^Pago #/ }).count(), 0,
    'Table already has split payments; refusing to mutate a stale fixture.');
}

async function openDetail(page, fixture) {
  await openUi(page, `${BASE}/admin/orders/${fixture.orderId}`,
    page.getByRole('heading', { name: `Orden #${fixture.orderNumber}` }), 'Order detail');
  const panel = page.locator('app-split-accounts-panel section.split-panel').first();
  await panel.waitFor();
  assert.equal(await panel.getByRole('heading', { name: 'Cuentas creadas' }).count(), 0,
    `Order ${fixture.orderNumber} already has a split; use a fresh fixture.`);
  assert(await panel.getByRole('button', { name: 'Ver vista previa del reparto' }).isVisible(),
    `Order ${fixture.orderNumber} is not eligible to create a split through its detail UI.`);
  return panel;
}

async function configureFour(panel, fixture) {
  const input = panel.locator('app-input[label="Número de comensales / cuentas"] input');
  await input.fill('4');
  const cards = panel.locator('.split-accounts .split-card').filter({ has: panel.locator('h4') });
  await panel.getByText('4 cuentas para gestionar.').waitFor();
  assert.equal(await cards.count(), 4, 'Choosing four diners must immediately show four editable account cards.');
  for (let i = 0; i < 4; i++) {
    await cards.nth(i).getByRole('heading', { name: `Comensal ${i + 1} · Cuenta ${i + 1}` }).waitFor();
    await cards.nth(i).locator('app-input[label="Nombre del comensal (opcional)"] input')
      .fill(fixture.aliases[i]);
  }
}

async function accountRows(panel, fixture, heading) {
  await panel.getByRole('heading', { name: heading }).waitFor();
  const rows = panel.locator('article.split-card');
  assert.equal(await rows.count(), 4, `${fixture.orderNumber}: expected four financial accounts.`);
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    const row = rows.nth(i);
    await row.getByRole('heading', { name: `Cuenta ${i + 1}`, exact: true }).waitFor();
    assert((await row.innerText()).includes(fixture.aliases[i]),
      `${fixture.orderNumber}: account ${i + 1} lost titular ${fixture.aliases[i]}.`);
    sum += cents(await row.locator('.split-row strong').first().innerText());
  }
  assert.equal(sum, fixture.totalCents,
    `${fixture.orderNumber}: four visible account totals must equal the source order.`);
  return rows;
}

async function previewAndCreate(panel, fixture, testStalePreview) {
  await configureFour(panel, fixture);
  await panel.getByRole('button', { name: 'Ver vista previa del reparto' }).click();
  await accountRows(panel, fixture, 'Vista previa — aún no se han creado las cuentas');
  if (testStalePreview) {
    // Revisit a valid alias after preview: a changed fingerprint must disable
    // creation until another preview. No server mutation is sent here.
    const firstAlias = panel.locator('.split-accounts .split-card').first()
      .locator('app-input[label="Nombre del comensal (opcional)"] input');
    await firstAlias.fill(`${fixture.aliases[0]} temporal`);
    await panel.getByText('Cambiaste el reparto. Genera otra vista previa').waitFor();
    assert(await panel.getByRole('button', { name: 'Crear 4 cuentas' }).isDisabled(),
      'Stale split preview must not be submitted.');
    await firstAlias.fill(fixture.aliases[0]);
    await panel.getByRole('button', { name: 'Ver vista previa del reparto' }).click();
    await accountRows(panel, fixture, 'Vista previa — aún no se han creado las cuentas');
  }
  const create = panel.getByRole('button', { name: 'Crear 4 cuentas' });
  assert(await create.isEnabled(), 'Fresh preview must enable Crear 4 cuentas.');
  await create.click();
  return accountRows(panel, fixture, 'Cuentas creadas');
}

async function payCash(page, panel, fixture, ordinal, amountCents, doubleSubmit = false) {
  const row = (await accountRows(panel, fixture, 'Cuentas creadas')).nth(ordinal - 1);
  const before = await row.locator('small').filter({ hasText: /^Pago #/ }).count();
  await row.getByRole('button', { name: /^Cobrar/ }).click();
  const modal = page.locator('app-payment-modal');
  await modal.getByRole('heading', { name: `Cobrar Cuenta ${ordinal}` }).waitFor();
  if (amountCents != null) {
    await modal.locator('input[placeholder="Usar monto sugerido"]')
      .fill(String(amountCents / 100));
  }
  await modal.locator('button.payment-method-btn').filter({ hasText: 'Efectivo' }).click();
  const submit = modal.getByRole('button', { name: /^Cobrar / }).last();
  await submit.waitFor({ state: 'visible' });
  assert(await submit.isEnabled(), 'Cash payment form should be valid before submit.');
  if (doubleSubmit) {
    // Two synchronous browser clicks exercise the UI busy/idempotency gate;
    // never issue HTTP requests directly or forge an idempotency key.
    await submit.evaluate((button) => { button.click(); button.click(); });
  } else {
    await submit.click();
  }
  await modal.waitFor({ state: 'hidden', timeout: 20_000 });
  const updated = (await accountRows(panel, fixture, 'Cuentas creadas')).nth(ordinal - 1);
  await updated.locator('small').filter({ hasText: /^Pago #/ }).nth(before).waitFor();
  assert.equal(await updated.locator('small').filter({ hasText: /^Pago #/ }).count(), before + 1,
    'One UI submit must create exactly one new payment, including the double-click probe.');
  return updated;
}

async function assertAllPaid(panel, fixture) {
  const rows = await accountRows(panel, fixture, 'Cuentas creadas');
  for (let i = 0; i < 4; i++) {
    const text = await rows.nth(i).innerText();
    assert(/Pagada\s*·\s*Saldo/.test(text), `Account ${i + 1} is not visibly paid.`);
    assert(/Saldo\s*\$?\s*0(?:[.,]00)?\b/.test(text), `Account ${i + 1} has a nonzero visible balance.`);
  }
}

async function readFiscalTotals(panel) {
  const rows = panel.locator('article.split-card');
  let tax = 0;
  let shipping = 0;
  for (let i = 0; i < 4; i++) {
    const details = rows.nth(i).locator('details');
    if (!(await details.evaluate((node) => node.open))) await details.locator('summary').click();
    const values = await details.locator('.split-totals span').allInnerTexts();
    const idxTax = values.indexOf('Impuestos');
    const idxShipping = values.indexOf('Envío');
    assert(idxTax >= 0 && idxShipping >= 0, 'Fiscal split detail must show tax and shipping components.');
    tax += cents(values[idxTax + 1]);
    shipping += cents(values[idxShipping + 1]);
  }
  return { tax, shipping };
}

async function assertSourceShippingTax(page, fixture) {
  const label = page.locator('span.pl-3').filter({ hasText: /IVA|INC|Impuesto/i }).first();
  await label.waitFor();
  const line = label.locator('xpath=..');
  assert.equal(cents(await line.locator('span').last().innerText()), fixture.shippingTaxCents,
    'Order detail must keep the visible shipping-tax snapshot.');
}

async function main() {
  const fixture = fixtureGate(); // Fail BEFORE browser launch or login.
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error?.message ?? error)));
  try {
    await login(page);

    await run('Four-person table split, partial/full pay, reload and close', 'happy/integrity', async () => {
      const f = fixture.table;
      await openTable(page, f);
      await page.locator('[dropdown-trigger]').filter({ hasText: 'Opciones' }).click();
      await page.getByRole('button', { name: 'Dividir cuenta' }).click();
      const modal = page.locator('app-split-order-modal');
      const panel = modal.locator('section.split-panel');
      await panel.waitFor();
      await previewAndCreate(panel, f, true);
      await page.keyboard.press('Escape');
      await modal.waitFor({ state: 'hidden' });
      const tablePanel = page.locator('app-split-accounts-panel section.split-panel').first();
      await accountRows(tablePanel, f, 'Cuentas creadas');
      await page.reload({ waitUntil: 'commit' });
      await page.getByText(`Sesión #${f.sessionId}`, { exact: false }).first().waitFor();
      await accountRows(tablePanel, f, 'Cuentas creadas');

      const partial = await payCash(page, tablePanel, f, 1, f.partialFirstCents, true);
      assert((await partial.innerText()).includes('Abono recibido'), 'First account must show partial payment.');
      await payCash(page, tablePanel, f, 1, null);
      for (let ordinal = 2; ordinal <= 4; ordinal++) await payCash(page, tablePanel, f, ordinal, null);
      await assertAllPaid(tablePanel, f);

      await page.reload({ waitUntil: 'commit' });
      await assertAllPaid(tablePanel, f);
      await page.locator('app-sticky-header').getByRole('button', { name: 'Cerrar mesa' }).click();
      await page.locator('app-confirmation-modal').getByRole('button', { name: 'Cerrar mesa' }).click();
      await page.getByText(`Sesión #${f.sessionId} — Cerrada`, { exact: false }).waitFor();
      await openUi(page, `${BASE}/admin/orders/${f.orderId}`,
        page.getByRole('heading', { name: `Orden #${f.orderNumber}` }), 'Paid table order detail');
      await assertAllPaid(page.locator('app-split-accounts-panel section.split-panel').first(), f);
      assert.equal(pageErrors.length, 0, `Browser runtime errors: ${pageErrors.join(' | ').slice(0, 300)}`);
      return `${f.orderNumber}: four titular accounts, 5 payments total (first split into 2), table closed, order detail paid`;
    });

    await run('Create four accounts from order detail and persist after reload', 'happy/sad', async () => {
      const f = fixture.detail;
      const panel = await openDetail(page, f);
      await previewAndCreate(panel, f, true);
      await page.reload({ waitUntil: 'commit' });
      await accountRows(page.locator('app-split-accounts-panel section.split-panel').first(), f, 'Cuentas creadas');
      assert.equal(pageErrors.length, 0, `Browser runtime errors: ${pageErrors.join(' | ').slice(0, 300)}`);
      return `${f.orderNumber}: detail split created and four titular amounts survive reload`;
    });

    await run('Taxed shipping is distributed without erasing IVA', 'fiscal/integrity', async () => {
      const f = fixture.taxedShipping;
      const panel = await openDetail(page, f);
      await assertSourceShippingTax(page, f);
      await configureFour(panel, f);
      await panel.getByRole('button', { name: 'Ver vista previa del reparto' }).click();
      await accountRows(panel, f, 'Vista previa — aún no se han creado las cuentas');
      assert.deepEqual(await readFiscalTotals(panel),
        { tax: f.taxCents, shipping: f.shippingCents },
        'Preview must preserve the source tax and shipping to the cent.');
      await panel.getByRole('button', { name: 'Crear 4 cuentas' }).click();
      await accountRows(panel, f, 'Cuentas creadas');
      await page.reload({ waitUntil: 'commit' });
      const reloaded = page.locator('app-split-accounts-panel section.split-panel').first();
      await accountRows(reloaded, f, 'Cuentas creadas');
      await assertSourceShippingTax(page, f);
      assert.deepEqual(await readFiscalTotals(reloaded),
        { tax: f.taxCents, shipping: f.shippingCents },
        'Persisted accounts must preserve tax and shipping after reload.');
      assert.equal(pageErrors.length, 0, `Browser runtime errors: ${pageErrors.join(' | ').slice(0, 300)}`);
      return `${f.orderNumber}: four accounts retain source shipping/IVA breakdown before and after reload`;
    });
  } finally {
    await browser.close();
  }
  assert.equal(results.length, 3, 'All three R12 browser scenarios must execute.');
  assert(results.every((result) => result.status === 'passed'), 'R12 contains a failed browser scenario.');
}

main().catch((error) => {
  process.stderr.write(`R12 E2E NOT VERIFIED: ${String(error?.message ?? error).slice(0, 1000)}\n`);
  process.exitCode = 1;
});
