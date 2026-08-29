import { test, expect } from '@playwright/test';
import { DEMO_ACCOUNT, HAS_DEMO_CREDENTIALS, BASE_URL } from './fixtures/demo-account';

/**
 * [print-editor-dsk P9] — Print-formats Editor Playwright e2e.
 *
 * Two specs pin the editor's mount lifecycle:
 *   1. open editor → preview iframe renders HTML (NOT a 500 page).
 *   2. open editor → save round-trip: click "Guardar", reload, confirm
 *      the persisted change survives the round-trip.
 *
 * Selectors are deliberately loose (`getByRole`, `getByText`) — the goal
 * is to assert the editor's high-level contract, not to lock the DOM.
 */

test.describe('Print-formats Editor — happy path', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!HAS_DEMO_CREDENTIALS, 'E2E_EMAIL / E2E_PASSWORD env vars are required');
    await page.goto(`${BASE_URL}/admin/login`);
    await page.fill('input[name="email"]', DEMO_ACCOUNT.email);
    await page.fill('input[name="password"]', DEMO_ACCOUNT.password);
    await Promise.all([
      page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 15000 }),
      page.click('button[type="submit"]'),
    ]);
  });

  test('Editor opens with a preview iframe', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/settings/print-formats/pos_sale_ticket`);
    // The canvas preview mounts an iframe (srcdoc) with the rendered HTML.
    // We assert the iframe is present and not empty.
    const iframe = page.locator('iframe').first();
    await expect(iframe).toBeVisible({ timeout: 10000 });
    // The preview MUST contain the `.vendix-print-page` wrapper that the
    // renderer injects (P2.2 single render path). We probe the iframe's
    // contentDocument via `frameLocator` so the assertion works cross-origin.
    const frame = page.frameLocator('iframe').first();
    await expect(frame.locator('.vendix-print-page')).toBeVisible({ timeout: 10000 });
  });

  test('Save and reload persists the change', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/settings/print-formats/pos_sale_ticket`);
    // Wait for the editor to mount before interacting.
    await expect(page.locator('iframe').first()).toBeVisible({ timeout: 10000 });

    // Capture the current "copies" value (default = 1) so we can flip it.
    const copiesInput = page.locator('input[name="copies"]').first();
    await expect(copiesInput).toBeVisible({ timeout: 5000 });
    const before = await copiesInput.inputValue();
    // Toggle to 2 (or back to 1 if it was already 2).
    const target = before === '1' ? '2' : '1';
    await copiesInput.fill(target);

    // Click "Guardar" — the primary action in the editor toolbar.
    await page.getByRole('button', { name: /guardar/i }).first().click();
    // The PUT round-trip must complete; wait for the success toast or
    // for the toolbar's save button to come back enabled.
    await page.waitForTimeout(1500);

    // Reload the same URL and assert the value persisted.
    await page.reload();
    await expect(page.locator('iframe').first()).toBeVisible({ timeout: 10000 });
    const copiesInputAfter = page.locator('input[name="copies"]').first();
    await expect(copiesInputAfter).toHaveValue(target);
  });
});
