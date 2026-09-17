import { test, expect } from '@playwright/test';
import { DEMO_ACCOUNT, HAS_DEMO_CREDENTIALS, BASE_URL } from './fixtures/demo-account';

/**
 * CP-pos-smart-search · E.4 (F-094) — interleaving refresh × search.
 *
 * Regla: un refresh durante una búsqueda pendiente (refreshTrigger de Vexi
 * o un re-tipeo — ambos embudan por `loadProducts()`) jamás blanquea la
 * grilla: la previa sobrevive (F-056) y el swap al rank de la última query
 * es atómico (seq-guard).
 *
 * Caso matriz: siembra grilla con query 1, retrasa la respuesta de query 2
 * 1.5s, sondea que el conteo de cards nunca llega a 0 durante el vuelo y
 * aserta que el rank final corresponde a la última query.
 *
 * Credenciales: E2E_EMAIL/E2E_PASSWORD deben ser de un dueño de tienda con
 * acceso al POS (local: owner@roku.vendix.com / 1125634q). Sin credenciales
 * el caso se salta (convención de la suite), nunca pasa en falso.
 */

test.use({ ignoreHTTPSErrors: true });

test.describe('POS search interleaving — no empty flash (F-094)', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(
      !HAS_DEMO_CREDENTIALS,
      'E2E_EMAIL / E2E_PASSWORD de un dueño de tienda son requeridos',
    );
    // Login por UI real: el guard hidrata NgRx solo vía este flujo (token
    // suelto en storage redirige al landing).
    await page.goto(`${BASE_URL}/auth/login`);
    await page.locator('input[type="email"]').fill(DEMO_ACCOUNT.email);
    await page.locator('input[type="password"]').fill(DEMO_ACCOUNT.password);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(
      (url) => !url.pathname.startsWith('/auth/login'),
      { timeout: 20000 },
    );
  });

  test('refresh durante search pendiente: sin flash vacío, rank final de la última query', async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/admin/pos`);
    // Scopeado al host: el placeholder existe ×2 en el POS (la otra
    // instancia es un modal auxiliar); la grilla bajo prueba es esta.
    const grid = page.locator('app-pos-product-selection').first();
    const searchBox = grid.locator(
      'input[placeholder="Busca por nombre, SKU o palabras en cualquier orden"]',
    );
    const cards = grid.locator('.product-card');
    await expect(searchBox).toBeVisible({ timeout: 20000 });

    // 1. Query 1 siembra la grilla previa (seed roku: [286]).
    await searchBox.fill('cafe');
    await expect(cards.first()).toBeVisible({ timeout: 15000 });
    expect(await cards.count()).toBeGreaterThan(0);

    // 2. Retrasa SOLO la siguiente respuesta de búsqueda (con search=): los
    // llamados de fondo sin query no se tocan.
    let delayed = false;
    await page.route('**/api/store/products*', async (route) => {
      const url = route.request().url();
      if (!delayed && url.includes('search=')) {
        delayed = true;
        await new Promise((r) => setTimeout(r, 1500));
      }
      await route.continue();
    });

    // 3. Query 2 mientras vuela: la grilla previa debe sobrevivir cada sondeo.
    const flight = page.waitForResponse(
      (resp) =>
        resp.url().includes('/api/store/products') &&
        resp.url().includes('search=') &&
        resp.request().method() === 'GET',
      { timeout: 20000 },
    );
    let settled = false;
    void flight.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    // Query 2 con resultados (seed roku: 'oster' → [287, 286]): 'cafe sello'
    // daría 0 filas por is_sellable=true (correcto, pero inútil para la matriz).
    await searchBox.fill('oster');

    let minCards = Number.POSITIVE_INFINITY;
    const pollStart = Date.now();
    while (!settled && Date.now() - pollStart < 19000) {
      const n = await cards.count();
      if (n < minCards) minCards = n;
      await page.waitForTimeout(100);
    }
    expect(delayed, 'la respuesta de query 2 debió retrasarse').toBe(true);
    expect(
      minCards,
      'la grilla previa jamás se blanquea durante el vuelo (F-094)',
    ).toBeGreaterThan(0);

    // 4. Tras el swap atómico: rank final = última query (seed roku:
    // rank-1 'Licuadora Oster Reversible 600W', 2 filas).
    await flight;
    await expect(cards).toHaveCount(2, { timeout: 10000 });
    await expect(cards.first()).toContainText(/licuadora/i);
  });
});
