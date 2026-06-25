// Verificación visual del estado actual de Stock Info (mobile parity)
// vs la versión web (inventory-overview.component.html).
import { chromium } from 'playwright';

const SCREENSHOTS_DIR = '/tmp/verify-inventory-parity';
const BASE_URL = 'http://localhost:8081';
const PROD_API = 'https://api.vendix.online/api';

const CREDS = {
  email: 'vendix.demo@gmail.com',
  password: 'vendixDEMO#$%1',
  organization_slug: 'vendix',
};

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

  await page.goto(`${BASE_URL}/(store-admin)/analytics/inventory`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitForAppReady(page);
  await page.waitForTimeout(3500);

  const url = page.url();
  console.log(`URL: ${url.replace(BASE_URL, '')}`);

  const checks = {
    // Header
    headerTitle: await page.locator('text=Dashboard de Inventario').count(),
    headerSubtitle: await page.locator('text=Resumen consolidado de inventario').count(),
    // Filter bar
    exportButton: await page.locator('text=Exportar').count(),
    // Stats — paridad web inventory-overview.component.html
    statValor: await page.locator('text=Valor en Stock').count(),
    statUnidades: await page.locator('text=Unidades en Mano').count(),
    statBajo: await page.locator('text=Bajo Stock').count(),
    statSin: await page.locator('text=Sin Stock').count(),
    // 3 chart cards
    chartMovimientos: await page.locator('text=Tendencia de Movimientos').count(),
    chartValorUbicacion: await page.locator('text=Valor por Ubicación').count(),
    chartCantidadUbicacion: await page.locator('text=Cantidad por Ubicación').count(),
    // Vistas de Inventario card
    viewsCard: await page.locator('text=Vistas de Inventario').count(),
    viewInfoStock: await page.locator('text=Info de Stock').count(),
    viewMovimientos: await page.locator('text=Movimientos').count(),
    viewValoracion: await page.locator('text=Valoración').count(),
    viewAnalisis: await page.locator('text=Análisis de Movimientos').count(),
    // Web NO tiene estos (los removimos en este fix)
    oldStatTotalSkus: await page.locator('text=Total SKUs').count(),
    oldHintAlertas: await page.locator('text=Alertas de Stock').count(),
  };

  console.log('\n=== Presencia de elementos ===');
  let pass = 0, fail = 0;
  for (const [k, v] of Object.entries(checks)) {
    const shouldBePresent = !k.startsWith('old');
    const present = v > 0;
    const matches = present === shouldBePresent;
    const icon = matches ? '✅' : '❌';
    const label = shouldBePresent ? '(esperado > 0)' : '(esperado 0)';
    console.log(`  ${icon} ${k}: ${v} ${label}`);
    if (matches) pass++; else fail++;
  }
  console.log(`\n  Resultado: ${pass}/${pass + fail} checks OK${fail > 0 ? ` (${fail} FALLARON)` : ''}`);

  // Screenshots
  await page.screenshot({ path: `${SCREENSHOTS_DIR}/01-top.png`, fullPage: false });
  await page.evaluate(() => window.scrollTo(0, 700));
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SCREENSHOTS_DIR}/02-mid.png`, fullPage: false });
  await page.evaluate(() => window.scrollTo(0, 1500));
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SCREENSHOTS_DIR}/03-bottom.png`, fullPage: false });
  await page.screenshot({ path: `${SCREENSHOTS_DIR}/00-fullpage.png`, fullPage: true });

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
