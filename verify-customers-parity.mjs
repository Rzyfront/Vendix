// Verificación visual del estado actual de Clientes (mobile parity)
// vs la versión web (customers.component.ts + customer-list.component.html).
//
// REQUIRES env vars: VERIFY_DEMO_EMAIL + VERIFY_DEMO_PASSWORD
//   export VERIFY_DEMO_EMAIL=...
//   export VERIFY_DEMO_PASSWORD=...
//   node verify-customers-parity.mjs
//
import { chromium } from 'playwright';

const SCREENSHOTS_DIR = '/tmp/verify-customers-parity';
const BASE_URL = 'http://localhost:8081';
const PROD_API = 'https://api.vendix.online/api';

const CREDS = {
  email: process.env.VERIFY_DEMO_EMAIL,
  password: process.env.VERIFY_DEMO_PASSWORD,
  organization_slug: process.env.VERIFY_DEMO_ORG_SLUG || 'vendix',
};

if (!CREDS.email || !CREDS.password) {
  console.error('❌ Faltan env vars: VERIFY_DEMO_EMAIL y VERIFY_DEMO_PASSWORD');
  console.error('   Setea con:');
  console.error('     export VERIFY_DEMO_EMAIL=tu@correo.com');
  console.error('     export VERIFY_DEMO_PASSWORD=tu_password');
  console.error('   Y vuelve a correr: node verify-customers-parity.mjs');
  process.exit(1);
}

async function loginAndSwitchToStoreAdmin(page) {
  return await page.evaluate(async ({ api, creds }) => {
    function unwrap(j) { return (j && j.success && j.data) ? j.data : j; }
    const res = await fetch(`${api}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(creds),
    });
    if (!res.ok) return { ok: false };
    let data; try { data = JSON.parse(await res.text()); } catch { data = {}; }
    const payload = unwrap(data);
    const orgToken = payload?.access_token;
    const storeSlug = payload?.user?.store?.slug;
    if (!orgToken || !storeSlug) return { ok: false };

    const sw = await fetch(`${api}/auth/switch-environment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${orgToken}` },
      body: JSON.stringify({ target_environment: 'STORE_ADMIN', store_slug: storeSlug }),
    });
    if (!sw.ok) return { ok: false };
    const swData = unwrap(JSON.parse(await sw.text()));
    const token = swData?.access_token;
    const refresh = swData?.refresh_token;
    if (!token) return { ok: false };

    window.localStorage.setItem('vendix_auth_token', token);
    if (refresh) window.localStorage.setItem('vendix_refresh_token', refresh);
    window.localStorage.setItem('vendix_auth_state', JSON.stringify({
      state: {
        user: swData.user,
        user_settings: swData.user_settings,
        store_settings: swData.store_settings,
        default_panel_ui: swData.default_panel_ui,
        token,
        refreshToken: refresh,
        roles: swData.user?.roles || [],
        permissions: [],
        isAuthenticated: true,
        isLoading: false,
      },
      version: 0,
    }));
    return { ok: true, storeSlug, storeName: swData.user?.store?.name };
  }, { api: PROD_API, creds: CREDS });
}

async function waitForAppReady(page) {
  await page.waitForFunction(
    () => document.querySelector('#root')?.children.length > 0,
    { timeout: 30000 }
  );
  await page.waitForTimeout(1500);
}

async function run() {
  const browser = await chromium.launch({
    headless: true,
    channel: 'chromium-headless-shell',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();

  const consoleErrors = [];
  const networkHits = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 250)); });
  page.on('pageerror', (e) => consoleErrors.push(`PAGEERROR: ${e.message}`));
  page.on('response', (r) => {
    if (r.url().includes('vendix.online')) {
      networkHits.push({ status: r.status(), url: r.url().replace(PROD_API, 'API') });
    }
  });

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitForAppReady(page);

  const ok = await loginAndSwitchToStoreAdmin(page);
  if (!ok) {
    console.log('❌ Login falló');
    await browser.close();
    return;
  }
  console.log(`✅ Login OK — store: ${ok.storeName}`);

  await page.goto(`${BASE_URL}/(store-admin)/customers`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitForAppReady(page);
  await page.waitForTimeout(3500);

  const url = page.url();
  console.log(`URL: ${url.replace(BASE_URL, '')}`);

  const checks = {
    // Stats — 4 (paridad web customers.component.html líneas 32-66)
    statTotal: await page.locator('text=Total clientes').count(),
    statActivos: await page.locator('text=Clientes activos').count(),
    statNuevos: await page.locator('text=Nuevos este mes').count(),
    statIngresos: await page.locator('text=Ingresos totales').count(),
    // Growth rates (React Native renderiza "+12%" y "vs mes pasado" en <Text> separados,
    // así que validamos presencia de cada uno + el conteo de "% vs mes pasado" en la página).
    growthRateValues: await page.locator('text=/\\+1[258]%|\\+5%|\\+15%/').count(),
    growthRateLabels: await page.locator('text=vs mes pasado').count(),
    // Search + OptionsDropdown triggers (aria-label añadido para paridad con orders/expenses)
    searchBar: await page.locator('input[placeholder*="Buscar clientes"]').count(),
    actionsTrigger: await page.locator('[aria-label="Acciones"]').count(),
    filtersTrigger: await page.locator('[aria-label="Filtros"]').count(),
    // Title count
    titleCount: await page.locator('text=/^Todos los Clientes \\(\\d+\\)$/').count(),
    // Customer card content
    cardEmail: await page.locator('text=/Sin correo registrado|@/').count(),
    cardTotalLabel: await page.locator('text=TOTAL GASTADO').count(),
    cardTelLabel: await page.locator('text=TELÉFONO').count(),
    cardPedidosLabel: await page.locator('text=PEDIDOS').count(),
  };

  console.log('\n=== Presencia de elementos ===');
  let pass = 0, fail = 0;
  for (const [k, v] of Object.entries(checks)) {
    const matches = v > 0;
    const icon = matches ? '✅' : '❌';
    console.log(`  ${icon} ${k}: ${v}`);
    if (matches) pass++; else fail++;
  }
  console.log(`\n  Resultado: ${pass}/${pass + fail} checks OK${fail > 0 ? ` (${fail} FALLARON)` : ''}`);

  // Screenshots
  await page.screenshot({ path: `${SCREENSHOTS_DIR}/01-top.png`, fullPage: false });
  await page.evaluate(() => window.scrollTo(0, 600));
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SCREENSHOTS_DIR}/02-mid.png`, fullPage: false });
  await page.screenshot({ path: `${SCREENSHOTS_DIR}/00-fullpage.png`, fullPage: true });

  // Click en Actions dropdown
  const actionsTrigger = page.locator('[aria-label="Acciones"]').first();
  if (await actionsTrigger.count() > 0) {
    try {
      await actionsTrigger.click({ timeout: 3000 });
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${SCREENSHOTS_DIR}/03-actions-open.png` });
      console.log('\n✅ Click en Actions dropdown OK');

      // Click "Nuevo Cliente" para abrir modal
      const newCustBtn = page.locator('text=Nuevo Cliente').first();
      if (await newCustBtn.count() > 0) {
        await newCustBtn.click({ timeout: 3000 });
        await page.waitForTimeout(800);
        await page.screenshot({ path: `${SCREENSHOTS_DIR}/04-create-modal.png` });
        console.log('✅ Modal Crear Cliente abierto');

        // Cerrar modal
        const closeBtn = page.locator('header button').first();
        if (await closeBtn.count() > 0) await closeBtn.click().catch(() => {});
        await page.waitForTimeout(500);
      }
    } catch (e) {
      console.log(`\n⚠️ Click en Actions: ${e.message}`);
    }
  }

  // Click en Filters dropdown
  const filtersTrigger = page.locator('[aria-label="Filtros"]').first();
  if (await filtersTrigger.count() > 0) {
    try {
      await filtersTrigger.click({ timeout: 3000 });
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${SCREENSHOTS_DIR}/05-filters-open.png` });
      console.log('✅ Click en Filters dropdown OK');
    } catch (e) {
      console.log(`⚠️ Click en Filters: ${e.message}`);
    }
  }

  // Network summary
  console.log('\n=== Network hits ===');
  const ok_ = networkHits.filter((n) => n.status >= 200 && n.status < 300);
  const err = networkHits.filter((n) => n.status >= 400);
  console.log(`  ✅ 2xx: ${ok_.length}`);
  ok_.slice(0, 12).forEach((n) => console.log(`     ${n.status} ${n.url}`));
  console.log(`  ❌ 4xx/5xx: ${err.length}`);
  err.slice(0, 12).forEach((n) => console.log(`     ${n.status} ${n.url}`));

  // Console errors
  console.log(`\n=== Console errors (${consoleErrors.length}) ===`);
  consoleErrors.slice(0, 10).forEach((e) => console.log(`  - ${e}`));

  console.log(`\nScreenshots en ${SCREENSHOTS_DIR}/`);
  await browser.close();
}

run().catch((e) => { console.error('Fatal:', e); process.exit(1); });
