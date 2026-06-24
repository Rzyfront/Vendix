// Verificación visual de los 7 botones "Accesos Rápidos" del dashboard store-admin
// App: Expo Web corriendo en http://localhost:8081
// API: https://api.vendix.online/api (producción, NO se levanta backend local)
import { chromium } from 'playwright';

const SCREENSHOTS_DIR = '/tmp/verify-quicklinks';
const BASE_URL = 'http://localhost:8081';
const PROD_API = 'https://api.vendix.online/api';

// Credenciales provistas por el usuario
const CREDS = {
  email: 'vendix.demo@gmail.com',
  password: 'vendixDEMO#$%1',
  organization_slug: 'vendix',
};

const BUTTONS = [
  { label: 'Resumen de Ventas', route: '/analytics/sales', selector: 'first' },
  { label: 'Ventas por Producto', route: '/analytics/products', selector: 'first' },
  // "Órdenes" y "Clientes" también aparecen como label del StatsGrid al tope del
  // dashboard — usamos .last() para saltar al botón en "Accesos Rápidos".
  { label: 'Órdenes', route: '/orders', selector: 'last' },
  { label: 'Stock Info', route: '/analytics/inventory', selector: 'first' },
  { label: 'Gastos', route: '/expenses', selector: 'first' },
  { label: 'Clientes', route: '/customers', selector: 'last' },
  { label: 'Compras', route: '/inventory/pop', selector: 'first' },
];

const results = [];

function log(msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

async function loginAndSwitchToStoreAdmin(page) {
  log('Haciendo login contra PRODUCTION API y luego switch a STORE_ADMIN...');
  const result = await page.evaluate(async ({ api, creds }) => {
    const out = { steps: [] };
    function unwrap(j) { return (j && j.success && j.data) ? j.data : j; }

    // Step 1: login (owner → ORG_ADMIN token por defecto)
    let res = await fetch(`${api}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(creds),
    });
    let raw = await res.text();
    let data; try { data = JSON.parse(raw); } catch { data = {}; }
    if (!res.ok) return { ok: false, step: 'login', status: res.status, raw: raw.slice(0, 1500) };
    let payload = unwrap(data);
    let orgToken = payload?.access_token;
    if (!orgToken) return { ok: false, step: 'login', raw: raw.slice(0, 1500) };
    out.steps.push('login:ok');
    out.userEmail = payload?.user?.email;
    out.roles = payload?.user?.roles || [];
    out.loginAppType = payload?.user_settings?.app_type;
    out.loginStoreSlug = payload?.user?.store?.slug;
    out.loginStoreName = payload?.user?.store?.name;
    out.loginUserStores = (payload?.user?.stores || []).map(s => ({ id: s.id, slug: s.slug, name: s.name, state: s.state }));

    // Step 2: obtener un store slug. Como el login ya da STORE_ADMIN,
    // usamos el store del user directamente, o intentamos /store/stores.
    let target = null;
    if (out.loginStoreSlug) {
      target = { id: payload?.user?.store?.id, name: out.loginStoreName, slug: out.loginStoreSlug, state: 'active' };
      out.steps.push('use_login_store');
    } else if (out.loginUserStores.length) {
      target = out.loginUserStores.find((s) => s.state === 'active' || s.state === 'ACTIVE') || out.loginUserStores[0];
      out.steps.push(`use_user_stores[0]`);
    } else {
      // Fallback: intentar /store/stores
      res = await fetch(`${api}/store/stores?limit=50`, {
        headers: { Authorization: `Bearer ${orgToken}` },
      });
      raw = await res.text();
      if (!res.ok) return { ok: false, step: 'list_stores', status: res.status, raw: raw.slice(0, 1000), out };
      try { data = JSON.parse(raw); } catch { data = {}; }
      const list = unwrap(data);
      const stores = Array.isArray(list) ? list : (list?.data || list?.items || []);
      if (!stores.length) return { ok: false, step: 'list_stores', msg: 'No stores found', out };
      target = stores.find((s) => s.state === 'active' || s.state === 'ACTIVE') || stores[0];
      out.steps.push(`list_stores:${stores.length}`);
    }
    out.targetStore = { id: target.id, name: target.name, slug: target.slug, state: target.state };

    // Step 3: switch-environment → STORE_ADMIN con el slug (usando ORG_ADMIN token)
    res = await fetch(`${api}/auth/switch-environment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${orgToken}`,
      },
      body: JSON.stringify({
        target_environment: 'STORE_ADMIN',
        store_slug: target.slug,
      }),
    });
    raw = await res.text();
    if (!res.ok) return { ok: false, step: 'switch_env', status: res.status, raw: raw.slice(0, 1500), out };
    try { data = JSON.parse(raw); } catch { data = {}; }
    payload = unwrap(data);
    const accessToken = payload?.access_token;
    const refreshToken = payload?.refresh_token;
    const user = payload?.user;
    const userSettings = payload?.user_settings;
    const storeSettings = payload?.store_settings;
    const defaultPanelUi = payload?.default_panel_ui;
    if (!accessToken) return { ok: false, step: 'switch_env', msg: 'No access_token in switch response', raw: raw.slice(0, 1500), out };
    out.steps.push('switch_env:ok');
    out.storeName = user?.store?.name;
    out.appType = userSettings?.app_type;

    // Step 4: inyectar estado zustand + tokens en localStorage
    window.localStorage.setItem('vendix_auth_token', accessToken);
    if (refreshToken) window.localStorage.setItem('vendix_refresh_token', refreshToken);

    const roles = user?.roles || [];
    const authState = {
      state: {
        user,
        user_settings: userSettings,
        store_settings: storeSettings,
        default_panel_ui: defaultPanelUi,
        token: accessToken,
        refreshToken,
        roles,
        permissions: [],
        isAuthenticated: true,
        isLoading: false,
      },
      version: 0,
    };
    window.localStorage.setItem('vendix_auth_state', JSON.stringify(authState));
    out.steps.push('injected');
    out.ok = true;
    return out;
  }, { api: PROD_API, creds: CREDS });

  log(`Login+Switch result: ${JSON.stringify(result, null, 2)}`);
  if (!result.ok) return false;
  log(`✅ Login OK como ${result.userEmail} → switched to store "${result.storeName}" (app_type=${result.appType})`);
  return true;
}

async function waitForAppReady(page) {
  await page.waitForFunction(
    () => document.querySelector('#root') && document.querySelector('#root').children.length > 0,
    { timeout: 30000 }
  );
  await page.waitForTimeout(2000);
}

async function run() {
  log('Lanzando Chromium headless-shell...');
  const browser = await chromium.launch({
    headless: true,
    channel: 'chromium-headless-shell',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  const consoleErrors = [];
  const networkLogs = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push({ url: page.url(), text: msg.text().slice(0, 300) });
    }
  });
  page.on('pageerror', (err) => {
    consoleErrors.push({ url: page.url(), text: `PAGEERROR: ${err.message}` });
  });
  page.on('request', (req) => {
    const u = req.url();
    if (u.includes('vendix.online') || u.includes('localhost:8081/api')) {
      networkLogs.push({ method: req.method(), url: u.replace(PROD_API, 'API'), postData: req.postData()?.slice(0, 200) });
    }
  });
  page.on('response', (res) => {
    const u = res.url();
    if (u.includes('vendix.online') || u.includes('localhost:8081/api')) {
      networkLogs.push({ kind: '→ RESP', status: res.status(), url: u.replace(PROD_API, 'API') });
    }
  });

  try {
    log(`Navegando a ${BASE_URL} (primera carga para activar origen)...`);
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForAppReady(page);
    log(`App lista. URL actual: ${page.url()}`);

    // Hacer login contra producción + switch a STORE_ADMIN + inyectar tokens
    const loginOk = await loginAndSwitchToStoreAdmin(page);
    if (!loginOk) {
      log('❌ Login falló — abortando verificación');
      await page.screenshot({ path: `${SCREENSHOTS_DIR}/00-login-fail.png`, fullPage: true }).catch(() => {});
      await browser.close();
      return;
    }

    // Recargar para que el auth.store rehidrate desde localStorage.
    // Navegamos explícitamente a /(store-admin)/dashboard para evitar ambigüedad
    // con /(org-admin)/dashboard que también matchea /dashboard.
    log('Recargando app con tokens inyectados → /(store-admin)/dashboard...');
    await page.goto(`${BASE_URL}/(store-admin)/dashboard`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForAppReady(page);
    await page.waitForTimeout(4000); // dar tiempo a queries a iniciar

    const urlAfterReload = page.url();
    log(`URL post-reload: ${urlAfterReload.replace(BASE_URL, '')}`);
    await page.screenshot({ path: `${SCREENSHOTS_DIR}/00-after-reload.png`, fullPage: true });

    if (urlAfterReload.includes('/login') || urlAfterReload.includes('/(auth)')) {
      log('❌ Seguimos en /login — auth.store no rehidrató correctamente');
      const ls = await page.evaluate(() => ({
        authToken: localStorage.getItem('vendix_auth_token')?.slice(0, 30),
        refreshToken: !!localStorage.getItem('vendix_refresh_token'),
        authState: localStorage.getItem('vendix_auth_state')?.slice(0, 200),
      }));
      log(`localStorage: ${JSON.stringify(ls)}`);
      await browser.close();
      return;
    }

    // Verificar que estamos en store-admin dashboard y aparece "Accesos Rápidos"
    log('Buscando sección "Accesos Rápidos"...');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(800);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);

    const hasQuickLinks = await page.locator('text=Accesos Rápidos').count();
    log(`Sección "Accesos Rápidos" encontrada: ${hasQuickLinks > 0 ? '✅' : '❌'} (${hasQuickLinks} ocurrencias)`);

    if (hasQuickLinks === 0) {
      log('⚠ No se encontró "Accesos Rápidos" — la pantalla actual puede no ser el dashboard');
      await page.screenshot({ path: `${SCREENSHOTS_DIR}/00-no-quicklinks.png`, fullPage: true });
    } else {
      await page.locator('text=Accesos Rápidos').first().scrollIntoViewIfNeeded();
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${SCREENSHOTS_DIR}/01-quicklinks-visible.png`, fullPage: true });

      // Probar cada botón
      for (let i = 0; i < BUTTONS.length; i++) {
        const btn = BUTTONS[i];
        const safeName = btn.label.toLowerCase().replace(/[^a-z0-9]/g, '-');
        log(`\n[${i + 1}/${BUTTONS.length}] "${btn.label}" → ${btn.route}`);

        // Volver al dashboard store-admin
        await page.goto(`${BASE_URL}/(store-admin)/dashboard`, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await waitForAppReady(page);
        await page.waitForTimeout(1500);
        await page.locator('text=Accesos Rápidos').first().scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);

        // Buscar el botón por texto exacto.
        // "Órdenes" y "Clientes" también aparecen como label del StatsGrid al
        // tope del dashboard — usar .last() para apuntar al botón en Accesos Rápidos.
        const selectorMethod = btn.selector || 'first';
        const btnLocator = page.locator(`text="${btn.label}"`)[selectorMethod]();
        const totalCount = await page.locator(`text="${btn.label}"`).count();
        if (totalCount === 0) {
          log(`  ❌ Botón "${btn.label}" no existe en el DOM`);
          results.push({ ...btn, status: 'NOT_FOUND' });
          continue;
        }
        log(`  selector: text="${btn.label}" .${selectorMethod}() (de ${totalCount} coincidencias)`);

        const urlBefore = page.url();
        let clickMethod = 'unknown';
        try {
          // RNW TouchableOpacity a veces no responde a .click(). Probar varios métodos.
          try {
            await btnLocator.click({ timeout: 2500 });
            clickMethod = 'click';
          } catch (e1) {
            log(`  ⚠ .click() falló (${e1.message.slice(0, 80)}), intentando force...`);
            try {
              await btnLocator.click({ force: true, timeout: 2500 });
              clickMethod = 'click-force';
            } catch (e2) {
              log(`  ⚠ force falló, intentando dispatch events...`);
              await btnLocator.dispatchEvent('click');
              clickMethod = 'dispatch';
            }
          }
        } catch (e) {
          log(`  ❌ Click agotó todas las opciones: ${e.message.slice(0, 100)}`);
        }
        await page.waitForTimeout(1800); // dar tiempo a queries + render
        const urlAfter = page.url();
        log(`  clickMethod=${clickMethod}`);
        log(`  URL: ${urlBefore.replace(BASE_URL, '')} → ${urlAfter.replace(BASE_URL, '')}`);

        await page.screenshot({
          path: `${SCREENSHOTS_DIR}/${String(i + 1).padStart(2, '0')}-${safeName}.png`,
          fullPage: true,
        });

        const navigated = urlAfter !== urlBefore;
        const matchesExpected = urlAfter.includes(btn.route);
        const pageText = await page.textContent('body').catch(() => '');
        const contentLen = pageText?.length || 0;

        // Detectar señales de carga real vs vacío
        const hasStatsNumbers = /\$\s?\d|\d{2,}/.test(pageText || '');
        const hasEmptyState =
          (pageText || '').toLowerCase().includes('sin datos') ||
          (pageText || '').toLowerCase().includes('no hay datos') ||
          (pageText || '').toLowerCase().includes('no data') ||
          (pageText || '').toLowerCase().includes('sin resultados');
        const hasSpinner = await page.locator('[role="progressbar"], [class*="spinner" i], [class*="loading" i]').count();

        let status;
        if (!navigated) {
          status = 'NO_NAV';
        } else if (!matchesExpected) {
          status = contentLen > 200 ? 'UNEXPECTED_URL' : 'NO_CONTENT';
        } else if (hasSpinner > 0) {
          status = 'LOADING';
        } else if (hasStatsNumbers && !hasEmptyState) {
          status = 'PASS_DATA';
        } else if (hasEmptyState) {
          status = 'PASS_EMPTY';
        } else if (contentLen > 200) {
          status = 'PASS_AMBIGUOUS';
        } else {
          status = 'EMPTY';
        }

        const icon =
          status === 'PASS_DATA' || status === 'PASS_EMPTY' || status === 'PASS_AMBIGUOUS'
            ? '✅'
            : status === 'NOT_FOUND' || status === 'NO_NAV' || status === 'NO_CONTENT'
              ? '❌'
              : '⚠️';
        log(`  ${icon} ${status} — contentLen=${contentLen} stats=${hasStatsNumbers} empty=${hasEmptyState} spinner=${hasSpinner}`);
        results.push({ ...btn, status, urlAfter: urlAfter.replace(BASE_URL, ''), contentLength: contentLen, clickMethod });
      }
    }

    // Reporte final
    log('\n═══════════════════════════════════════════');
    log('REPORTE FINAL — Botones "Accesos Rápidos"');
    log('═══════════════════════════════════════════');
    for (const r of results) {
      const icon =
        r.status === 'PASS_DATA' || r.status === 'PASS_EMPTY' || r.status === 'PASS_AMBIGUOUS'
          ? '✅'
          : r.status === 'NOT_FOUND' || r.status === 'NO_NAV' || r.status === 'NO_CONTENT'
            ? '❌'
            : '⚠️';
      log(`${icon} "${r.label}" → ${r.route}: ${r.status} (${r.urlAfter || 'no-url'}) content=${r.contentLength || 0} chars`);
    }
    const passed = results.filter((r) =>
      ['PASS_DATA', 'PASS_EMPTY', 'PASS_AMBIGUOUS'].includes(r.status)
    ).length;
    log(`\nResultado: ${passed}/${results.length} PASS (de los cuales DATA=${results.filter((r) => r.status === 'PASS_DATA').length})`);

    if (consoleErrors.length > 0) {
      log(`\n⚠ Errores de consola (${consoleErrors.length}):`);
      consoleErrors.slice(0, 25).forEach((e) => log(`  - [${e.url.replace(BASE_URL, '')}] ${e.text}`));
    } else {
      log('\n✅ Sin errores de consola');
    }

    log(`\nNetwork hits (${networkLogs.length}):`);
    networkLogs.slice(0, 30).forEach((n) => log(`  ${JSON.stringify(n)}`));

    log(`\nScreenshots en ${SCREENSHOTS_DIR}/`);
  } catch (err) {
    log(`❌ Error fatal: ${err.message}`);
    log(err.stack);
    await page.screenshot({ path: `${SCREENSHOTS_DIR}/ERROR.png`, fullPage: true }).catch(() => {});
  } finally {
    await browser.close();
  }
}

run().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});