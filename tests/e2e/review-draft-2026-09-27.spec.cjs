/*
 * R16 — repeatable browser-only POS draft regression on the local Roku store.
 *
 * QA_EMAIL=... QA_PASSWORD=... NODE_PATH=/opt/homebrew/lib/node_modules \
 *   node tests/e2e/review-draft-2026-09-27.spec.cjs
 *
 * Creates one draft for an identified customer through the POS UI, edits that SAME
 * draft, and cancels it through the order-detail UI. No direct API calls,
 * stored browser state, credentials, or signed image URLs are emitted.
 * Defaults reflect the Roku seed: Samsung has a real base image and the 55"
 * variant; Coca-Cola is the second, direct-delivery product. Override fixture
 * names through QA_DRAFT_IMAGE_PRODUCT, QA_DRAFT_VARIANT_LABEL and
 * QA_DRAFT_ADDED_PRODUCT if the local seed changes.
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const BASE = process.env.QA_BASE_URL || 'https://vendix.com';
const IMAGE_PRODUCT = process.env.QA_DRAFT_IMAGE_PRODUCT || 'Smart TV Samsung 55" 4K UHD';
const VARIANT = process.env.QA_DRAFT_VARIANT_LABEL || '55"';
const ADDED_PRODUCT = process.env.QA_DRAFT_ADDED_PRODUCT || 'Coca-Cola 400ml';
const checks = [];

async function check(scheme, name, action) {
  const started = Date.now();
  try {
    const evidence = await action();
    checks.push({ reviewIds: ['R16'], scheme, name, status: 'passed', evidence,
      ms: Date.now() - started });
    process.stdout.write(`PASS ${scheme} ${name}: ${evidence}\n`);
  } catch (error) {
    const message = String(error?.message ?? error).slice(0, 1_100);
    checks.push({ reviewIds: ['R16'], scheme, name, status: 'failed', evidence: message,
      ms: Date.now() - started });
    process.stderr.write(`FAIL ${scheme} ${name}: ${message}\n`);
    throw error;
  }
}

async function openView(page, path, ready) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.goto(`${BASE}${path}`, { waitUntil: 'commit', timeout: 30_000 });
      await ready.waitFor({ timeout: 12_000 });
      return;
    } catch {
      // A native frontend/backend rebuild can commit an empty Angular shell.
    }
  }
  throw new Error(`The local UI did not render ${path}; current URL=${page.url()}`);
}

async function login(page) {
  assert(process.env.QA_EMAIL && process.env.QA_PASSWORD,
    'Supply QA_EMAIL and QA_PASSWORD through the process environment.');
  await openView(page, '/auth/login', page.locator('input[type=email]'));
  // SSR can paint the form before Angular attaches its submit listener.
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
  await page.locator('input[type=email]').fill(process.env.QA_EMAIL);
  await page.locator('input[type=password]').fill(process.env.QA_PASSWORD);
  if (await page.getByText('Demasiados intentos de inicio de sesión').isVisible()) {
    throw new Error('The local login rate limit is active; wait for its UI countdown.');
  }
  await page.getByRole('button', { name: 'Iniciar Sesión' }).click();
  await page.waitForFunction(() => {
    try {
      return Boolean(JSON.parse(localStorage.getItem('vendix_auth_state') || '{}')
        ?.tokens?.access_token);
    } catch { return false; }
  }, null, { timeout: 20_000 });
  await openView(page, '/admin/pos', page.getByText('Carrito Actual', { exact: true }));
  const storyClose = page.getByRole('button', { name: 'Cerrar Tu semana en Vendix' });
  if (await storyClose.isVisible()) await storyClose.click();
}

function cartItems(page) {
  return page.locator('app-pos-cart [data-purpose="cart-item"]');
}

function cartItem(page, name) {
  return cartItems(page).filter({ hasText: name });
}

function detailItem(page, name) {
  return page.locator('.items-compact > div').filter({ hasText: name });
}

async function loadedImage(row, label) {
  const image = row.locator('img').first();
  await image.waitFor();
  await image.evaluate(async (img) => {
    if (!img.complete) {
      await Promise.race([
        new Promise((resolve) => {
          img.addEventListener('load', resolve, { once: true });
          img.addEventListener('error', resolve, { once: true });
        }),
        new Promise((resolve) => setTimeout(resolve, 10_000)),
      ]);
    }
  });
  assert(await image.evaluate((img) => img.complete && img.naturalWidth > 0),
    `${label}: the real product image did not load`);
  // A presigned S3 URL rotates its query string. Compare only the resource
  // path, never log/persist the tokenized URL itself.
  return image.evaluate((img) => new URL(img.currentSrc || img.src, location.href).pathname);
}

async function searchAndChoose(page, name, variantLabel = null, requireImage = false) {
  await page.getByRole('textbox', { name: 'Buscar productos' }).fill(name);
  const card = page.getByRole('list', { name: 'Resultados de productos' })
    .getByRole('listitem').filter({ hasText: name }).first();
  await card.waitFor();
  const catalogImagePath = requireImage
    ? await loadedImage(card, 'Image-bearing product catalog card') : null;
  await card.click();
  if (variantLabel) {
    const selector = page.locator('app-pos-variant-selector');
    await selector.getByRole('heading', { name: 'Seleccionar variante' }).waitFor();
    await selector.getByRole('button').filter({ hasText: variantLabel }).first().click();
  }
  await cartItem(page, name).waitFor();
  return catalogImagePath;
}

async function next(shell) {
  await shell.locator('button.btn-confirm').filter({ hasText: 'Siguiente' }).click();
}

async function createDraft(page, onPersisted) {
  await page.getByRole('list', { name: 'Resultados de productos' })
    .getByRole('listitem').first().waitFor();
  assert.equal(await cartItems(page).count(), 0,
    'POS already contains another cart. Preserve it and abort rather than clearing unrelated work.');
  const catalogImagePath = await searchAndChoose(page, IMAGE_PRODUCT, VARIANT, true);
  const initialImagePath = await loadedImage(cartItem(page, IMAGE_PRODUCT), 'Initial POS cart');
  assert.equal(initialImagePath, catalogImagePath,
    'The POS cart did not use the image from its product catalog card');
  await page.getByRole('button', { name: 'Guardar / Espera' }).click();
  const shell = page.locator('app-pos-checkout-shell');
  await shell.getByText('Paso 1 de 2: Pedido').waitFor();
  await shell.getByRole('radio', { name: /Para llevar/ }).click();
  await shell.getByText('Paso 2 de 2: Cliente').waitFor();
  // Samsung exceeds the POS document-equivalent 5 UVT limit. An alias is
  // legally insufficient here; choose a real customer instead of weakening
  // the fiscal gate merely to exercise the draft editor.
  await shell.getByRole('radio', { name: /Con Cliente/ }).click();
  const customerSearch = shell.locator('app-pos-customer-selector app-inputsearch input');
  await customerSearch.fill('Camila Torres');
  await shell.locator('app-pos-customer-selector button.customer-result')
    .filter({ hasText: 'Camila Torres' }).first().click();
  await shell.locator('button.btn-draft').click();
  const confirmation = page.locator('app-pos-order-confirmation');
  try {
    await confirmation.getByText('¡Orden Guardada!').waitFor({ timeout: 20_000 });
  } catch {
    const alerts = (await shell.getByRole('alert').allTextContents()).join(' | ');
    const visible = (await shell.innerText()).slice(-900);
    const globalTail = (await page.locator('body').innerText()).slice(-500);
    throw new Error(`Guardar borrador no confirmó; URL=${page.url()}; alertas=${alerts.slice(0, 280)}; wizard=${visible}; UI=${globalTail}`);
  }
  const text = await confirmation.innerText();
  const number = text.match(/POS-\d{4}-\d+/)?.[0];
  assert(number, `Saved-draft confirmation has no order number: ${text.slice(0, 200)}`);
  await confirmation.getByRole('button', { name: 'Ver detalle' }).click();
  await page.waitForFunction(() => /^\/admin\/orders\/\d+$/.test(location.pathname));
  const id = Number(new URL(page.url()).pathname.split('/').at(-1));
  onPersisted({ id, number, initialImagePath });
  await page.getByRole('heading', { name: `Orden #${number}` }).waitFor();
  await page.locator('app-sticky-header').getByText('Borrador', { exact: true }).waitFor();
  await detailItem(page, IMAGE_PRODUCT).waitFor();
  assert.equal(await loadedImage(detailItem(page, IMAGE_PRODUCT), 'Initial draft detail'), initialImagePath,
    'Saving the draft changed the original product image resource');
  return { id, number, initialImagePath };
}

async function openDraftInEditor(page, draft) {
  await page.getByRole('button', { name: 'Modificar Orden' }).first().click();
  await page.waitForFunction((id) => location.pathname === '/admin/pos' &&
    new URLSearchParams(location.search).get('editOrder') === String(id), draft.id);
  await cartItem(page, IMAGE_PRODUCT).waitFor();
  assert.equal(await loadedImage(cartItem(page, IMAGE_PRODUCT), 'Reopened draft cart'),
    draft.initialImagePath, 'Opening the draft for edit lost its original image');
  assert.equal(await cartItems(page).count(), 1,
    'The editor did not load exactly the preexisting draft line');
  assert(!(await page.locator('app-pos-checkout-shell .checkout-shell').isVisible()),
    'Editing the saved draft repeated the creation wizard before any action');
}

async function assertSingleOrderInList(page, number) {
  await openView(page, '/admin/orders/sales',
    page.locator('input[placeholder="Buscar órdenes..."]'));
  await page.locator('input[placeholder="Buscar órdenes..."]').fill(number);
  const rows = page.getByRole('table').getByRole('row').filter({ hasText: number });
  await rows.first().waitFor({ timeout: 20_000 });
  await page.waitForTimeout(800); // debounced list search
  assert.equal(await rows.count(), 1,
    'Double Guardar or editor save created another order with the same order number');
  assert.match(await rows.first().innerText(), new RegExp(number));
}

async function cancelDraft(page, draft) {
  await openView(page, `/admin/orders/${draft.id}`,
    page.getByRole('heading', { name: `Orden #${draft.number}` }));
  const cancel = page.getByRole('button', { name: 'Cancelar Orden' }).first();
  await cancel.waitFor();
  await cancel.click();
  const reason = page.locator('app-modal textarea[formcontrolname="reason"]');
  await reason.waitFor();
  await reason.fill('Limpieza de borrador QA R16');
  await page.getByRole('button', { name: 'Cancelar Orden' }).last().click();
  await page.getByText('Orden Cancelada', { exact: true }).waitFor({ timeout: 20_000 });
}

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(30_000);
  const consoleErrors = new Set();
  const writeOutcomes = [];
  page.on('response', (response) => {
    if (response.request().method() !== 'GET' && /\/store\/payments\/pos/.test(response.url())) {
      writeOutcomes.push(`${response.request().method()} ${new URL(response.url()).pathname}: ${response.status()}`);
    }
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.add(message.text().match(/(?:NG\d+|[A-Za-z]+Error)/)?.[0] || 'OtherConsoleError');
    }
  });
  let draft = null;
  let cancelled = false;
  let failed = false;
  try {
    await login(page);
    await check('happy', 'create a photographed draft and reopen the same order', async () => {
      draft = await createDraft(page, (persisted) => { draft = persisted; });
      await openDraftInEditor(page, draft);
      return `${draft.number} / order ${draft.id}: original image loaded in draft and editor`;
    });
    await check('sad', 'add a product and save without repeating the creation wizard', async () => {
      await searchAndChoose(page, ADDED_PRODUCT);
      assert.equal(await cartItems(page).count(), 2);
      assert.equal(await loadedImage(cartItem(page, IMAGE_PRODUCT), 'Cart after second item'),
        draft.initialImagePath, 'Adding an item removed the earlier photo');
      assert(!(await page.locator('app-pos-checkout-shell .checkout-shell').isVisible()),
        'Adding an item unexpectedly reopened the creation wizard');
      await page.getByRole('button', { name: 'Guardar / Espera' }).dblclick({ delay: 30 });
      await page.getByText(`Orden #${draft.number} guardada`).waitFor({ timeout: 20_000 });
      assert.equal(new URLSearchParams(new URL(page.url()).search).get('editOrder'), String(draft.id),
        'Editor save navigated to a different order');
      assert(!(await page.locator('app-pos-checkout-shell .checkout-shell').isVisible()),
        'Editor save repeated the checkout wizard');
      return `double Guardar stayed in editor for order ${draft.id}`;
    });
    await check('brute', 'reload and list retain one draft ID, both items and photo', async () => {
      await page.reload({ waitUntil: 'commit' });
      await cartItem(page, IMAGE_PRODUCT).waitFor();
      await cartItem(page, ADDED_PRODUCT).waitFor();
      assert.equal(await cartItems(page).count(), 2);
      assert.equal(await loadedImage(cartItem(page, IMAGE_PRODUCT), 'Reloaded editor'),
        draft.initialImagePath, 'Reload dropped the original image');
      await openView(page, `/admin/orders/${draft.id}`,
        page.getByRole('heading', { name: `Orden #${draft.number}` }));
      await page.locator('app-sticky-header').getByText('Borrador', { exact: true }).waitFor();
      await detailItem(page, IMAGE_PRODUCT).waitFor();
      await detailItem(page, ADDED_PRODUCT).waitFor();
      assert.equal(await page.locator('.items-compact > div').count(), 2);
      assert.equal(await loadedImage(detailItem(page, IMAGE_PRODUCT), 'Reloaded order detail'),
        draft.initialImagePath, 'Persisted order lost the original image');
      await assertSingleOrderInList(page, draft.number);
      return `${draft.number}: one list row, two persisted lines and same photo resource`;
    });
    await check('happy', 'cancel the QA draft and clear stale POS-linked cart', async () => {
      await cancelDraft(page, draft);
      cancelled = true;
      await openView(page, '/admin/pos', page.getByText('Carrito Actual', { exact: true }));
      await page.locator('app-pos-cart [role="list"][aria-label="Ítems del carrito"] [role="status"]')
        .waitFor({ timeout: 20_000 });
      // The linked-order guard checks the server after cart hydration; the
      // cart may briefly show the old lines before that read completes.
      await page.waitForFunction(() =>
        document.querySelectorAll('app-pos-cart [data-purpose="cart-item"]').length === 0,
      null, { timeout: 20_000 });
      assert.equal(await cartItems(page).count(), 0,
        'Returning to POS kept the cart linked to a cancelled order');
      assert(!new URL(page.url()).searchParams.has('editOrder'),
        'The cancelled draft left editOrder in the POS URL');
      assert(!(await page.getByText('Invalid order status').isVisible()),
        'The POS attempted to write to a cancelled order');
      return `cancelled order ${draft.id}; POS cart empty on return`;
    });
  } catch {
    failed = true;
  } finally {
    if (draft && !cancelled) {
      try {
        await cancelDraft(page, draft);
        process.stdout.write(`CLEANUP cancelled QA draft ${draft.number}\n`);
      } catch (error) {
        failed = true;
        process.stderr.write(`CLEANUP REQUIRED for QA draft ${draft.number} / ${draft.id}: ${String(error?.message ?? error).slice(0, 240)}\n`);
      }
    }
    process.stdout.write(`${JSON.stringify({ reviewIds: ['R16'], checks,
      writeOutcomes, consoleErrorNames: [...consoleErrors] })}\n`);
    await context.close();
    await browser.close();
  }
  if (failed || checks.some((entry) => entry.status !== 'passed')) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`R16 runner failed: ${String(error?.message ?? error).slice(0, 700)}\n`);
  process.exitCode = 1;
});
