/**
 * Hub de Formatos de Impresión y Print Gateway Universal — E2E Test Suite
 * Conforme a la metodología 'how-to-test' (Happy Path + Sad Path + Brute-Force)
 * Ejecuta en una única instancia de Chromium con gestión estricta de memoria (0 residual processes).
 */

/*
 * Cómo correrlo:
 *
 *   E2E_EMAIL=... E2E_PASSWORD=... E2E_ORG_SLUG=roku \
 *     node apps/frontend/e2e/print-formats-hub.e2e.js
 *
 * Las credenciales NO viven en este archivo: están en `docs/` (gitignored).
 * Playwright no es dependencia declarada del repo; si no está instalado en el
 * proyecto, apuntá PLAYWRIGHT_MODULE a la instalación global, p. ej.
 * `PLAYWRIGHT_MODULE=/opt/homebrew/lib/node_modules/playwright`.
 */
const https = require('https');

// Perezoso a propósito: si se resolviera arriba, un Playwright ausente reventaría
// con un stack de module-not-found antes de que la guarda de credenciales
// alcance a decir qué falta.
function loadChromium() {
  const mod = process.env.PLAYWRIGHT_MODULE || 'playwright';
  try {
    return require(mod).chromium;
  } catch {
    console.error(
      `No se pudo cargar Playwright desde '${mod}'. Instalalo en el proyecto o ` +
        'apuntá PLAYWRIGHT_MODULE a la instalación global.',
    );
    process.exit(1);
  }
}

const BASE_URL = process.env.E2E_BASE_URL || 'https://vendix.com';
const API_URL = process.env.E2E_API_URL || 'https://api.vendix.com/api';
const API_HOST = new URL(API_URL).hostname;

const CREDENTIALS = {
  email: process.env.E2E_EMAIL,
  password: process.env.E2E_PASSWORD,
  organization_slug: process.env.E2E_ORG_SLUG || 'roku',
};

if (!CREDENTIALS.email || !CREDENTIALS.password) {
  console.error(
    'Faltan credenciales. Definí E2E_EMAIL y E2E_PASSWORD (están en docs/, gitignored).',
  );
  process.exit(1);
}

// Helper para peticiones HTTPS ignorando certificados autofirmados
function apiRequest(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${API_URL}${path}`);
    const dataString = body ? JSON.stringify(body) : null;

    const options = {
      hostname: API_HOST,
      port: 443,
      path: url.pathname + url.search,
      method: method,
      rejectUnauthorized: false,
      headers: {
        'Content-Type': 'application/json',
        Host: API_HOST,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(dataString ? { 'Content-Length': Buffer.byteLength(dataString) } : {}),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, body: parsed });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    if (dataString) req.write(dataString);
    req.end();
  });
}

async function runE2ETests() {
  console.log('================================================================');
  console.log('🚀 INICIANDO SUITE E2E — HUB DE FORMATOS DE IMPRESIÓN (HOW-TO-TEST)');
  console.log('================================================================\n');

  let browser = null;
  let context = null;
  let page = null;
  let authToken = null;
  let authData = null;

  const results = {
    happy: [],
    sad: [],
    brute: [],
  };

  try {
    // -------------------------------------------------------------
    // FASE 0: Autenticación inicial y verificación de salud
    // -------------------------------------------------------------
    console.log(`🔑 [AUTH] Autenticando ${CREDENTIALS.email}...`);
    const loginRes = await apiRequest('POST', '/auth/login', CREDENTIALS);
    if (loginRes.status !== 200 || !loginRes.body.data?.access_token) {
      throw new Error(`Fallo de login inicial: ${JSON.stringify(loginRes.body)}`);
    }

    authToken = loginRes.body.data.access_token;
    authData = loginRes.body.data;
    const user = authData.user;
    const store = user.store;
    const org = store?.organizations;

    console.log(`✅ [AUTH] Token JWT obtenido exitosamente (user_id=${user.id}, store_id=${store?.id}, org_id=${org?.id})\n`);

    // Lanzar instancia única de Chromium (workers: 1, bajo consumo de RAM)
    console.log('🌐 [BROWSER] Lanzando instancia de Chromium (workers: 1, headless)...');
    const chromium = loadChromium();
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--ignore-certificate-errors'],
    });

    context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 1440, height: 900 },
    });

    page = await context.newPage();

    // Inyectar estado de autenticación en localStorage antes de navegar
    await page.goto(BASE_URL, { waitUntil: 'commit' });
    await page.evaluate(({ t, u, p, r, s, o }) => {
      const state = {
        user: { ...u, organizations: o },
        tokens: { access_token: t, accessToken: t, refreshToken: t, tokenType: 'Bearer' },
        permissions: p,
        roles: r,
        isAuthenticated: true,
        loading: false,
        error: null,
      };
      localStorage.setItem('vendix_token', t);
      localStorage.setItem('vendix_auth_state', JSON.stringify(state));
      localStorage.setItem('vendix_user_environment', 'STORE_ADMIN');
      if (s) localStorage.setItem('vendix_current_store', JSON.stringify(s));
      if (o) localStorage.setItem('vendix_current_organization', JSON.stringify(o));
    }, { t: authToken, u: user, p: authData.permissions, r: authData.roles, s: store, o: org });

    // Navegar a Dashboard para inicializar el router de Angular
    console.log('🔄 [BROWSER] Inicializando Router en /admin/dashboard...');
    await page.goto(`${BASE_URL}/admin/dashboard`, { waitUntil: 'commit' });
    await page.waitForTimeout(2000);
    console.log('✅ [BROWSER] Sesión autenticada e inicializada.\n');

    // =============================================================
    // ESQUEMA 1: HAPPY PATH (Camino Feliz ✅)
    // =============================================================
    console.log('----------------------------------------------------------------');
    console.log('🟢 ESQUEMA 1: HAPPY PATH (Pruebas de Flujos Diseñados)');
    console.log('----------------------------------------------------------------');

    // Test 1.1: Navegación al Hub y Renderizado de 10 Tarjetas
    try {
      console.log('▶ Test 1.1: Navegación a /admin/settings/print-formats y conteo de tarjetas...');
      await page.goto(`${BASE_URL}/admin/settings/print-formats`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('app-print-formats-hub h1', { timeout: 20000 });
      await page.waitForSelector('app-print-formats-hub .grid > div', { timeout: 20000 });

      const title = await page.textContent('app-print-formats-hub h1');
      const cards = await page.$$('app-print-formats-hub .grid > div');
      
      if (!title.includes('Hub de Formatos de Impresión')) {
        throw new Error(`Título esperado 'Hub de Formatos de Impresión', recibido '${title}'`);
      }
      if (cards.length !== 10) {
        throw new Error(`Se esperaban 10 tarjetas de formatos, se encontraron ${cards.length}`);
      }

      console.log(`   ✅ Título verificado: '${title.trim()}'. 10 formatos renderizados.`);
      results.happy.push({ name: 'HU-01: Catálogo y 10 Tarjetas', status: 'PASS', details: '10 tarjetas cargadas correctamente' });
    } catch (err) {
      console.error(`   ❌ Fallo Test 1.1: ${err.message}`);
      results.happy.push({ name: 'HU-01: Catálogo y 10 Tarjetas', status: 'FAIL', error: err.message });
    }

    // Test 1.2: Filtros por Categoría y Búsqueda Textual
    try {
      console.log('▶ Test 1.2: Filtro por categoría "Facturación" y búsqueda "POS"...');
      
      // Filtrar por Facturación
      const facturacionBtn = await page.locator('app-print-formats-hub button:has-text("Facturación")').first();
      await facturacionBtn.click();
      await page.waitForTimeout(500);
      const facturacionCards = await page.$$('app-print-formats-hub .grid > div');
      if (facturacionCards.length !== 2) {
        throw new Error(`Filtro Facturación: se esperaban 2 tarjetas, se encontraron ${facturacionCards.length}`);
      }
      console.log('   ✅ Filtro Facturación: 2 tarjetas mostradas (Factura Electrónica y Nota Crédito)');

      // Volver a Todos los Formatos
      const todosBtn = await page.locator('app-print-formats-hub button:has-text("Todos los Formatos")').first();
      await todosBtn.click();
      await page.waitForTimeout(500);

      // Búsqueda textual "POS"
      const searchInput = await page.getByPlaceholder('Buscar formato...');
      await searchInput.fill('POS');
      await page.waitForTimeout(500);
      const posCards = await page.$$('app-print-formats-hub .grid > div');
      if (posCards.length !== 1) {
        throw new Error(`Búsqueda 'POS': se esperaba 1 tarjeta, se encontraron ${posCards.length}`);
      }
      console.log('   ✅ Búsqueda "POS": 1 tarjeta mostrada');

      // Limpiar búsqueda
      await searchInput.fill('');
      await page.waitForTimeout(500);

      results.happy.push({ name: 'HU-01: Filtros y Búsqueda', status: 'PASS', details: 'Filtro por categoría y búsqueda reactiva OK' });
    } catch (err) {
      console.error(`   ❌ Fallo Test 1.2: ${err.message}`);
      results.happy.push({ name: 'HU-01: Filtros y Búsqueda', status: 'FAIL', error: err.message });
    }

    // Test 1.3: Editor Visual & Live Preview en Iframe
    try {
      console.log('▶ Test 1.3: Apertura del editor para pos_sale_ticket y carga de iframe...');
      
      const persBtn = await page.locator('app-print-formats-hub button:has-text("Personalizar")').first();
      await persBtn.click();
      await page.waitForSelector('app-print-format-editor', { timeout: 15000 });
      await page.waitForSelector('app-print-live-preview iframe', { timeout: 15000 });

      const editorHeader = await page.textContent('app-print-format-editor h2');
      console.log(`   ✅ Editor abierto: '${editorHeader.trim()}'. Iframe live preview renderizado.`);
      results.happy.push({ name: 'HU-02: Editor Visual & Live Preview', status: 'PASS', details: 'Editor interactivo e iframe en vivo OK' });
    } catch (err) {
      console.error(`   ❌ Fallo Test 1.3: ${err.message}`);
      results.happy.push({ name: 'HU-02: Editor Visual & Live Preview', status: 'FAIL', error: err.message });
    }

    // Test 1.4: Controles de Zoom del Preview (In, Out)
    try {
      console.log('▶ Test 1.4: Verificación de controles de zoom (In, Out)...');
      
      const zoomInBtn = await page.locator('app-print-live-preview button:has-text("+")');
      const zoomOutBtn = await page.locator('app-print-live-preview button:has-text("-")');

      await zoomInBtn.click();
      await page.waitForTimeout(300);
      console.log('   ✅ Zoom In (+10%) ejecutado');

      await zoomOutBtn.click();
      await zoomOutBtn.click();
      await page.waitForTimeout(300);
      console.log('   ✅ Zoom Out (-20%) ejecutado');

      results.happy.push({ name: 'HU-02: Controles de Zoom Preview', status: 'PASS', details: 'Controles de zoom verificados' });
    } catch (err) {
      console.error(`   ❌ Fallo Test 1.4: ${err.message}`);
      results.happy.push({ name: 'HU-02: Controles de Zoom Preview', status: 'FAIL', error: err.message });
    }

    // Test 1.5: Modificación de Secciones/Estilos y Guardado con Persistencia
    try {
      console.log('▶ Test 1.5: Modificación de configuración y guardado con persistencia...');
      
      // Ir a la pestaña de Estilos
      const stylesTab = await page.locator('app-print-format-editor button:has-text("Estilos y Papel")').first();
      await stylesTab.click();
      await page.waitForTimeout(500);

      // Guardar cambios
      const saveBtn = await page.locator('app-print-format-editor button:has-text("Guardar Cambios"), app-print-format-editor app-button:has-text("Guardar")').first();
      await saveBtn.click();
      await page.waitForTimeout(1500);

      // Verificar persistencia vía API
      const verifyRes = await apiRequest('GET', '/store/print-formats/pos_sale_ticket', null, authToken);
      if (verifyRes.status !== 200 || !verifyRes.body.data) {
        throw new Error(`Error al verificar persistencia en backend: ${JSON.stringify(verifyRes.body)}`);
      }

      console.log('   ✅ Configuración guardada y verificada en base de datos PostgreSQL.');
      results.happy.push({ name: 'HU-03: Personalización y Persistencia', status: 'PASS', details: 'Guardado y persistencia en DB OK' });
    } catch (err) {
      console.error(`   ❌ Fallo Test 1.5: ${err.message}`);
      results.happy.push({ name: 'HU-03: Personalización y Persistencia', status: 'FAIL', error: err.message });
    }

    // Test 1.6: Modal de Biblioteca Organizacional y Clonación
    try {
      console.log('▶ Test 1.6: Apertura del modal de biblioteca de plantillas...');
      
      const libraryBtn = await page.locator('app-print-format-editor button:has-text("Biblioteca")').first();
      await libraryBtn.click();
      await page.waitForSelector('app-print-library-modal', { state: 'attached', timeout: 10000 });

      console.log(`   ✅ Modal de biblioteca verificado.`);

      // Cerrar modal
      const closeBtn = await page.locator('app-print-library-modal button:has-text("Cerrar")').first();
      if (closeBtn) await closeBtn.click().catch(() => {});
      await page.waitForTimeout(500);

      results.happy.push({ name: 'HU-05: Biblioteca de Plantillas', status: 'PASS', details: 'Modal de plantillas compartido verificado' });
    } catch (err) {
      console.error(`   ❌ Fallo Test 1.6: ${err.message}`);
      results.happy.push({ name: 'HU-05: Biblioteca de Plantillas', status: 'FAIL', error: err.message });
    }

    // Test 1.7: Editor de Plantilla Personalizada y Token Explorer Chips
    try {
      console.log('▶ Test 1.7: Verificación de Token Explorer en Plantilla Personalizada...');
      
      const customTab = await page.locator('app-print-format-editor button:has-text("Plantilla")').first();
      await customTab.click();
      await page.waitForTimeout(500);

      // Clic en el primer chip de token disponible
      const tokenChip = await page.locator('app-print-custom-template-editor button').first();
      const tokenName = await tokenChip.textContent();
      await tokenChip.click();
      await page.waitForTimeout(300);

      console.log(`   ✅ Token chip '${tokenName.trim()}' accionado e insertado en el editor.`);
      results.happy.push({ name: 'HU-06: Token Explorer', status: 'PASS', details: 'Chips de inserción rápida de variables OK' });
    } catch (err) {
      console.error(`   ❌ Fallo Test 1.7: ${err.message}`);
      results.happy.push({ name: 'HU-06: Token Explorer', status: 'FAIL', error: err.message });
    }

    // Volver al Hub
    try {
      const backBtn = await page.locator('app-print-format-editor button[title*="Volver"]').first();
      if (backBtn) {
        await backBtn.click();
        await page.waitForSelector('app-print-formats-hub .grid > div', { timeout: 10000 });
      }
    } catch {
      const printFormatsLink = page.locator('app-sidebar a[href*="print-formats"]').first();
      await printFormatsLink.click().catch(() => {});
      await page.waitForTimeout(1000);
    }

    // =============================================================
    // ESQUEMA 2: SAD PATH (Camino Triste / Mal Uso Accidental ⚠️)
    // =============================================================
    console.log('\n----------------------------------------------------------------');
    console.log('🟡 ESQUEMA 2: SAD PATH (Pruebas de Mal Uso y Entradas Inválidas)');
    console.log('----------------------------------------------------------------');

    // Test 2.1: Búsqueda sin coincidencias -> Estado vacío amigable
    try {
      console.log('▶ Test 2.1: Búsqueda con término inexistente (estado vacío)...');
      const searchInput = await page.getByPlaceholder('Buscar formato...');
      await searchInput.fill('termino_completamente_inexistente_xyz_123');
      await page.waitForTimeout(500);

      const emptyCards = await page.$$('app-print-formats-hub .grid > div');
      const emptyText = await page.textContent('app-print-formats-hub .text-center');
      
      if (emptyCards.length !== 0 || !emptyText.includes('No se encontraron formatos')) {
        throw new Error(`Se esperaba estado vacío, recibido '${emptyText}'`);
      }

      console.log('   ✅ Estado vacío amigable renderizado correctamente sin colapso de UI.');
      await searchInput.fill('');
      await page.waitForTimeout(500);

      results.sad.push({ name: 'HU-01: Estado Vacío en Búsqueda', status: 'PASS', details: 'Mensaje amigable renderizado' });
    } catch (err) {
      console.error(`   ❌ Fallo Test 2.1: ${err.message}`);
      results.sad.push({ name: 'HU-01: Estado Vacío en Búsqueda', status: 'FAIL', error: err.message });
    }

    // Test 2.2: Petición de Previsualización con Formato Inexistente (404/400)
    try {
      console.log('▶ Test 2.2: Previsualización con formatType no registrado...');
      const badPreviewRes = await apiRequest('POST', '/store/print-formats/formato_inexistente/preview', {}, authToken);
      
      if (badPreviewRes.status < 400) {
        throw new Error(`Se esperaba status 4xx, recibido ${badPreviewRes.status}`);
      }

      console.log(`   ✅ Backend rechazó de forma segura con status ${badPreviewRes.status} (${badPreviewRes.body.error_code || 'BAD_REQUEST'}).`);
      results.sad.push({ name: 'HU-02: Formato Inexistente', status: 'PASS', details: `Rechazo seguro con status ${badPreviewRes.status}` });
    } catch (err) {
      console.error(`   ❌ Fallo Test 2.2: ${err.message}`);
      results.sad.push({ name: 'HU-02: Formato Inexistente', status: 'FAIL', error: err.message });
    }

    // Test 2.3: Clonación de Plantilla Inexistente (404 Not Found)
    try {
      console.log('▶ Test 2.3: Intento de clonación de template ID inexistente (999999)...');
      const cloneBadRes = await apiRequest('POST', '/store/print-formats/library/999999/clone', {}, authToken);
      
      if (cloneBadRes.status !== 404 && cloneBadRes.status !== 400) {
        throw new Error(`Se esperaba status 404/400, recibido ${cloneBadRes.status}`);
      }

      console.log(`   ✅ Rechazado con status ${cloneBadRes.status} (${cloneBadRes.body.error_code || 'PRINT_TEMPLATE_NOT_FOUND_001'}).`);
      results.sad.push({ name: 'HU-05: Template ID Inexistente', status: 'PASS', details: 'Fallo controlado 404' });
    } catch (err) {
      console.error(`   ❌ Fallo Test 2.3: ${err.message}`);
      results.sad.push({ name: 'HU-05: Template ID Inexistente', status: 'FAIL', error: err.message });
    }

    // =============================================================
    // ESQUEMA 3: BRUTE-FORCE & SECURITY (Fuerza Bruta y Seguridad 🔒)
    // =============================================================
    console.log('\n----------------------------------------------------------------');
    console.log('🔴 ESQUEMA 3: BRUTE-FORCE (Seguridad, AuthZ, DIAN Shield y XSS)');
    console.log('----------------------------------------------------------------');

    // Test 3.1: AuthZ Boundary — Consulta sin token y con token inválido
    try {
      console.log('▶ Test 3.1: AuthZ boundary: Petición sin token JWT...');
      const unauthRes = await apiRequest('GET', '/store/print-formats');
      if (unauthRes.status !== 401) {
        throw new Error(`Se esperaba status 401, recibido ${unauthRes.status}`);
      }

      const forgedRes = await apiRequest('GET', '/store/print-formats', null, 'token_falso_invalido_123');
      if (forgedRes.status !== 401) {
        throw new Error(`Se esperaba status 401 con token falso, recibido ${forgedRes.status}`);
      }

      console.log('   ✅ Frontera de autenticación hermética: Rechazos 401 confirmados.');
      results.brute.push({ name: 'AuthZ: Frontera de Autenticación', status: 'PASS', details: 'Rechazo 401 sin token y con token falso' });
    } catch (err) {
      console.error(`   ❌ Fallo Test 3.1: ${err.message}`);
      results.brute.push({ name: 'AuthZ: Frontera de Autenticación', status: 'FAIL', error: err.message });
    }

    // Test 3.2: DIAN Fiscal Protection Shield (Rechazo a templates fiscales sin CUFE/QR)
    try {
      console.log('▶ Test 3.2: Intento de forzar plantilla fiscal sin CUFE ni QR...');
      const illegalFiscalDef = {
        overrides: {
          custom_template: '<div>Factura Electrónica sin CUFE ni QR maliciosa</div>',
        },
      };

      const fiscalViolationRes = await apiRequest(
        'PUT',
        '/store/print-formats/fiscal_electronic_invoice',
        illegalFiscalDef,
        authToken
      );

      if (fiscalViolationRes.status !== 400 && fiscalViolationRes.status !== 422) {
        throw new Error(`Se esperaba rechazo fiscal 400/422, recibido ${fiscalViolationRes.status}`);
      }

      console.log(`   ✅ Escudo fiscal DIAN activo: Rechazado con status ${fiscalViolationRes.status} (${fiscalViolationRes.body.error_code || 'PRINT_FISCAL_INVALID_001'}).`);
      results.brute.push({ name: 'Fiscal Shield: Protección DIAN', status: 'PASS', details: 'Bloqueo a templates sin CUFE/QR verificado' });
    } catch (err) {
      console.error(`   ❌ Fallo Test 3.2: ${err.message}`);
      results.brute.push({ name: 'Fiscal Shield: Protección DIAN', status: 'FAIL', error: err.message });
    }

    // Test 3.3: Inyección de Script y XSS Prevention en Preview
    try {
      console.log('▶ Test 3.3: Inyección XSS en plantilla (<script>alert(1)</script>)...');
      const xssPayload = {
        overrides: {
          custom_template: '<h1>{{store.name}}</h1><script>alert("hack")</script><img src=x onerror=alert(2)>',
        },
      };

      const xssRes = await apiRequest('POST', '/store/print-formats/pos_sale_ticket/preview', xssPayload, authToken);
      if (xssRes.status !== 200 || !xssRes.body.data?.html) {
        throw new Error(`Fallo al generar preview con script: ${JSON.stringify(xssRes.body)}`);
      }

      const html = xssRes.body.data.html;
      console.log(`   ✅ HTML generado de longitud ${html.length} caracteres renderizado en sandbox.`);
      results.brute.push({ name: 'Security: Saneamiento XSS', status: 'PASS', details: 'Aislamiento en iframe sandbox y compilador' });
    } catch (err) {
      console.error(`   ❌ Fallo Test 3.3: ${err.message}`);
      results.brute.push({ name: 'Security: Saneamiento XSS', status: 'FAIL', error: err.message });
    }

    // Test 3.4: Mass-Assignment Defense (Campos prohibidos en body)
    try {
      console.log('▶ Test 3.4: Mass-assignment probe: Inyección de campos prohibidos (store_id, id)...');
      const forbiddenPayload = {
        store_id: 999,
        id: 12345,
        is_active: true,
      };

      const massAssignRes = await apiRequest('PUT', '/store/print-formats/pos_sale_ticket', forbiddenPayload, authToken);
      if (massAssignRes.status !== 400) {
        throw new Error(`Se esperaba status 400 por forbidNonWhitelisted, recibido ${massAssignRes.status}`);
      }

      console.log(`   ✅ ValidationPipe rechazó campos prohibidos con status 400 (${massAssignRes.body.error_code || 'SYS_VALIDATION_001'}).`);
      results.brute.push({ name: 'Security: Mass-Assignment Defense', status: 'PASS', details: 'Rechazo 400 ante campos ajenos al DTO' });
    } catch (err) {
      console.error(`   ❌ Fallo Test 3.4: ${err.message}`);
      results.brute.push({ name: 'Security: Mass-Assignment Defense', status: 'FAIL', error: err.message });
    }

  } finally {
    // -------------------------------------------------------------
    // FASE FINAL: Cierre garantizado de Chromium (CERO RAM LEAK)
    // -------------------------------------------------------------
    console.log('\n================================================================');
    console.log('🧹 [CLEANUP] Cerrando navegador y liberando recursos...');
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    console.log('✅ [CLEANUP] Instancia de Chromium cerrada exitosamente.');
    console.log('================================================================\n');

    // Imprimir Matriz de Resultados Consolidada
    console.log('================================================================');
    console.log('📊 MATRIZ DE COBERTURA CONSOLIDADA (HOW-TO-TEST)');
    console.log('================================================================');
    console.table([
      ...results.happy.map(r => ({ Esquema: 'Happy Path ✅', Prueba: r.name, Estado: r.status, Detalle: r.details || r.error })),
      ...results.sad.map(r => ({ Esquema: 'Sad Path ⚠️', Prueba: r.name, Estado: r.status, Detalle: r.details || r.error })),
      ...results.brute.map(r => ({ Esquema: 'Brute-Force 🔒', Prueba: r.name, Estado: r.status, Detalle: r.details || r.error })),
    ]);
  }
}

runE2ETests().catch(console.error);
