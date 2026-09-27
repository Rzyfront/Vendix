/*
 * R17, UI-only oversell regression for the disposable Roku QA fixture.
 *
 * QA_EMAIL=... QA_PASSWORD=... NODE_PATH=/opt/homebrew/lib/node_modules \
 *   node tests/e2e/review-oversell-2026-09-27.spec.cjs
 *
 * This deliberately does NOT complete a paid sale: absent a proven UI-only
 * refund path in this script, selling a zero-stock item would leave negative
 * inventory when a test fails halfway through. The old manual sale+refund is
 * documented in docs/qa/review-2026-09-27-ui-verification.md. This test covers
 * the repeatable settings/POS UI boundary and always restores the store's
 * original switch and removes its local cart line.
 *
 * No direct API/DB calls, stored credentials, or backend writes outside UI.
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const base = process.env.QA_BASE_URL || 'https://vendix.com';
const productName = 'QA NoOversell A';
const settingsUrl = `${base}/admin/settings/general/logistica`;
const posUrl = `${base}/admin/pos`;

async function openUi(page, url, locator, description) {
  let lastError = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'commit', timeout: 20_000 });
      await locator.waitFor({ timeout: 15_000 });
      return;
    } catch (error) {
      lastError = String(error?.message ?? error).slice(0, 180);
      await page.goto('about:blank', { waitUntil: 'commit', timeout: 5_000 }).catch(() => {});
    }
  }
  throw new Error(`${description} no apareció en la UI: ${page.url()}; ${lastError}`);
}

async function login(page) {
  assert(process.env.QA_EMAIL && process.env.QA_PASSWORD,
    'QA_EMAIL y QA_PASSWORD deben venir del entorno; nunca del código.');
  await openUi(page, `${base}/auth/login`, page.locator('input[type="email"]'), 'Login');
  await page.waitForTimeout(900); // Angular listeners after local SSR hydration.
  if (process.env.QA_STORE_SLUG || process.env.QA_ORG_SLUG) {
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
    throw new Error('Login rate-limited: no reintentar hasta que la UI desbloquee la cuenta.');
  }
  await page.getByRole('button', { name: 'Iniciar Sesión' }).click();
  await page.waitForFunction(() => {
    try {
      const state = JSON.parse(localStorage.getItem('vendix_auth_state') || '{}');
      return Boolean(state?.tokens?.access_token && state?.user?.id);
    } catch { return false; }
  }, null, { timeout: 20_000 });
  await openUi(page, posUrl, page.getByText('Carrito Actual', { exact: true }), 'POS');
  const weekly = page.getByRole('button', { name: 'Cerrar Tu semana en Vendix' });
  if (await weekly.isVisible()) await weekly.click();
}

function switchLocator(page) {
  return page.locator('app-setting-toggle[label="Permitir sobreventa"] [role="button"]');
}

async function openSettings(page) {
  const toggle = switchLocator(page);
  if (page.url().includes('/admin/settings/general/logistica') && await toggle.isVisible()) {
    return toggle;
  }
  await openUi(page, settingsUrl, toggle, 'Logística / Permitir sobreventa');
  return toggle;
}

async function openPos(page, description) {
  const ready = page.locator('input[aria-label="Buscar productos"]:visible').first();
  if (page.url().includes('/admin/pos') && await ready.isVisible()) return;
  // Prefer Angular's visible sidebar navigation after saving settings. A
  // full document navigation from Logística can race local Vite/HMR and leave
  // a blank bootstrap even though the same SPA route works by clicking.
  const link = page.locator('a[href^="/admin/pos"]').first();
  if (page.viewportSize()?.width >= 768 && await link.isVisible().catch(() => false)) {
    try {
      await link.click({ timeout: 5_000 });
      await ready.waitFor({ timeout: 12_000 });
      return;
    } catch {}
  }
  await openUi(page, posUrl, ready, description);
}

async function setOversell(page, enabled) {
  let toggle = await openSettings(page);
  const before = await toggle.getAttribute('aria-pressed');
  assert(['true', 'false'].includes(before), 'El interruptor de sobreventa no hidrató.');
  if ((before === 'true') !== enabled) {
    await toggle.click();
    const save = page.getByRole('button', { name: 'Guardar Cambios' });
    await save.click();
    // The settings store re-reads canonical data after a successful save.
    // Wait for its dirty-action to disable rather than hard-reloading the
    // same Vite route, which can strand the page on about:blank in dev.
    for (let attempt = 0; attempt < 40 && !(await save.isDisabled()); attempt++) {
      await page.waitForTimeout(250);
    }
    assert(await save.isDisabled(), 'Guardar Cambios no terminó de persistir.');
    toggle = await openSettings(page);
  }
  assert.equal(await toggle.getAttribute('aria-pressed'), String(enabled),
    `Permitir sobreventa no persistió en ${enabled}`);
}

async function openProduct(page, mobile) {
  await openPos(page, 'POS');
  await page.getByRole('textbox', { name: 'Buscar productos' }).fill(productName);
  const list = page.getByRole('list', {
    name: mobile ? 'Resultados de productos móviles' : 'Resultados de productos',
  });
  const card = list.getByRole('listitem').filter({ hasText: productName }).first();
  await card.waitFor({ timeout: 20_000 });
  return card;
}

async function clearOnlyQaCartLine(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openPos(page, 'POS para limpieza');
  const remove = page.getByRole('button', {
    name: /Eliminar QA NoOversell A.*del carrito/,
  });
  if (await remove.count()) {
    await remove.click();
    await remove.waitFor({ state: 'detached' });
  }
}

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
  let page = await context.newPage();
  const settingsPage = await context.newPage();
  page.setDefaultTimeout(15_000);
  settingsPage.setDefaultTimeout(15_000);
  const refreshPos = async (mobile = false) => {
    await page.close();
    page = await context.newPage();
    page.setDefaultTimeout(15_000);
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
    await openUi(page, posUrl,
      page.locator('input[aria-label="Buscar productos"]:visible').first(),
      'POS con ajuste de sobreventa actualizado');
  };
  let originalSetting;
  let touchedSetting = false;
  let touchedCart = false;
  const failures = [];
  try {
    await login(page);
    let card = await openProduct(page, false);
    // A shared developer database is not a disposable fixture. Abort before
    // changing settings if another tester has changed stock/cart state.
    assert.match(await card.innerText(), /(?:0\s+Disponibles|AGOTADO|SOBREVENTA)/i,
      `${productName} ya no es una fixture de stock cero.`);
    assert.match(await page.locator('app-pos-cart').innerText(), /0 ítems seleccionados/,
      'El carrito debe comenzar vacío para no interferir con otra sesión QA.');
    const toggle = await openSettings(settingsPage);
    const initial = await toggle.getAttribute('aria-pressed');
    assert(['true', 'false'].includes(initial), 'No se pudo leer la configuración inicial.');
    originalSetting = initial === 'true';

    touchedSetting = true;
    await setOversell(settingsPage, false);
    await refreshPos();
    card = await openProduct(page, false);
    assert.equal(await card.getAttribute('aria-disabled'), 'true');
    assert.match(await card.innerText(), /AGOTADO/);
    await card.click();
    await page.getByText(/No puedes agregar QA NoOversell A.*no hay unidades disponibles/)
      .waitFor();
    assert.match(await page.locator('app-pos-cart').innerText(), /0 ítems seleccionados/);
    console.log('PASS R17 OFF: AGOTADO, explicación y carrito intacto');

    await setOversell(settingsPage, true);
    await refreshPos();
    card = await openProduct(page, false);
    assert.notEqual(await card.getAttribute('aria-disabled'), 'true');
    assert.match(await card.innerText(), /SOBREVENTA/);
    touchedCart = true;
    await card.click();
    const line = page.locator('app-pos-cart').filter({ hasText: productName });
    await line.getByRole('button', { name: /Eliminar QA NoOversell A.*del carrito/ }).waitFor();
    assert.match(await line.innerText(), /Sobreventa de QA NoOversell A/i);
    // Quantity beyond zero must be permitted, but remain explicitly warned.
    const quantity = line.getByRole('textbox', { name: 'Cantidad' }).first();
    await quantity.fill('2');
    await quantity.press('Enter');
    await line.getByRole('status').getByText(/2 unidades solicitadas/i).waitFor();
    assert.equal(await quantity.inputValue(), '2');
    assert.match(await line.innerText(), /Sobreventa de QA NoOversell A.*: 2 unidades solicitadas/i);
    console.log('PASS R17 ON: producto agotado y cantidad 2 en carrito con advertencia');

    await clearOnlyQaCartLine(page);
    touchedCart = false;
    await page.setViewportSize({ width: 390, height: 844 });
    card = await openProduct(page, true);
    assert.notEqual(await card.getAttribute('aria-disabled'), 'true');
    assert.match(await card.innerText(), /Sobreventa/);
    console.log('PASS R17 móvil ON: ficha agotada disponible con advertencia');

    await setOversell(settingsPage, false);
    await refreshPos(true);
    card = await openProduct(page, true);
    assert.equal(await card.getAttribute('aria-disabled'), 'true');
    assert.match(await card.innerText(), /Agotado/);
    console.log('PASS R17 móvil OFF: ficha agotada bloqueada');
  } catch (error) {
    failures.push(error);
  } finally {
    // Both cleanups use only visible UI. A failed cleanup is a hard test
    // failure; never print PASS while leaving the shared QA store changed.
    if (touchedCart) {
      try { await clearOnlyQaCartLine(page); } catch (error) { failures.push(error); }
    }
    if (touchedSetting && originalSetting !== undefined) {
      try {
        await setOversell(settingsPage, originalSetting);
      } catch (error) { failures.push(error); }
    }
    await browser.close();
  }
  if (failures.length) throw new AggregateError(failures, 'R17 UI E2E falló o no pudo restaurar la fixture.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
