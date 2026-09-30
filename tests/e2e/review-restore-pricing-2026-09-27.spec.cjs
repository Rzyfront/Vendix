/* UI-only recovery for the disposable R9/R21 fruit fixture after an
 * interrupted Playwright run. No direct API or database mutations. */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

(async () => {
  assert(process.env.QA_EMAIL && process.env.QA_PASSWORD);
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ ignoreHTTPSErrors: true });
  try {
    await page.goto('https://vendix.com/auth/login', { waitUntil: 'commit' });
    await page.locator('input[type=email]').waitFor();
    await page.waitForTimeout(900);
    await page.locator('input[type=email]').fill(process.env.QA_EMAIL);
    await page.locator('input[type=password]').fill(process.env.QA_PASSWORD);
    await page.getByRole('button', { name: 'Iniciar Sesión' }).click();
    await page.waitForFunction(() => {
      try { return Boolean(JSON.parse(localStorage.getItem('vendix_auth_state') || '{}')?.tokens?.access_token); }
      catch { return false; }
    });
    const edit = 'https://vendix.com/admin/products/edit/298?fromPage=1';
    const chip = page.locator('vendix-tax-inclusive-chip');
    for (let attempt = 0; attempt < 12; attempt++) {
      await page.goto(edit, { waitUntil: 'commit' }).catch(() => {});
      if (await chip.waitFor({ timeout: 7_000 }).then(() => true).catch(() => false)) break;
      await page.goto('about:blank', { waitUntil: 'commit' }).catch(() => {});
    }
    if (!await chip.isVisible()) {
      throw new Error(`Product editor unavailable: ${page.url()} ${(await page.locator('body').innerText()).slice(0, 500)}`);
    }
    const toggle = page.locator('app-setting-toggle[label="Activar precio de oferta"] [role=button]');
    let changed = false;
    if (await toggle.getAttribute('aria-pressed') === 'true') {
      await page.locator('app-input[formcontrolname="sale_price"] input').fill('0');
      await toggle.click();
      changed = true;
    }
    const inclusive = chip.getByRole('button', {
      name: 'IVA General 19%: impuesto incluido en el precio unitario',
    });
    if (await inclusive.isVisible()) {
      await inclusive.click();
      changed = true;
    }
    if (changed) {
      await page.getByRole('button', { name: 'Guardar', exact: true }).click();
      await page.waitForFunction(() => location.pathname === '/admin/products');
    }
    await page.goto(edit, { waitUntil: 'commit' });
    await chip.getByRole('button', {
      name: 'IVA General 19%: impuesto adicional sobre el precio unitario',
    }).waitFor();
    assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
    console.log('PASS R9/R21 fixture restored through UI');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
