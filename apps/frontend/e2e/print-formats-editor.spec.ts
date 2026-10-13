import { test, expect, type Page, type Request } from '@playwright/test';
import { DEMO_ACCOUNT, HAS_DEMO_CREDENTIALS, BASE_URL } from './fixtures/demo-account';

const FORMAT_TYPE = 'pos_sale_ticket';
const HUB_URL = `${BASE_URL}/admin/settings/print-formats`;
const DETAIL_PATH = `/store/print-formats/${FORMAT_TYPE}`;

type FormatSnapshot = {
  is_active: boolean;
  gateway_enabled: boolean;
  template_id: number | null;
  overrides: Record<string, unknown> | null;
};

function isLocalVendixOrigin(): boolean {
  try {
    const hostname = new URL(BASE_URL).hostname;
    return hostname === 'vendix.com' || hostname.endsWith('.vendix.com');
  } catch {
    return false;
  }
}

function isFormatDetailRequest(request: Request): boolean {
  const url = new URL(request.url());
  return url.pathname.endsWith(DETAIL_PATH) && request.method() === 'GET';
}

async function login(page: Page): Promise<void> {
  test.skip(!isLocalVendixOrigin(), `Mutation-capable editor E2E is local-only (BASE_URL=${BASE_URL})`);
  test.skip(!HAS_DEMO_CREDENTIALS, 'E2E_EMAIL / E2E_PASSWORD env vars are required');

  await page.goto(`${BASE_URL}/auth/login`);
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(DEMO_ACCOUNT.email);
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(DEMO_ACCOUNT.password);
  // The fixture's E2E_ORG_SLUG is the documented tenant selector when the
  // default vendix.com host is used; only fill it when the real login form exposes it.
  const organizationSlug = page.locator('input[name="organization_slug"]');
  if (await organizationSlug.count()) {
    await organizationSlug.fill(DEMO_ACCOUNT.organization_slug);
  }
  await Promise.all([
    page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 15000 }),
    page.getByRole('button', { name: 'Iniciar Sesión', exact: true }).click(),
  ]);
}

async function openPosSaleTicketFromHub(page: Page): Promise<void> {
  const title = page.getByRole('heading', { name: 'Ticket de Venta POS', exact: true });
  await expect(title).toBeVisible();
  const welcomeClose = page.getByRole('button', { name: 'Cerrar Tu semana en Vendix', exact: true });
  if (await welcomeClose.isVisible().catch(() => false)) {
    await welcomeClose.click();
  }
  await title.click();
}

async function openEditor(page: Page): Promise<Request> {
  const detailRequestPromise = page.waitForRequest(isFormatDetailRequest, { timeout: 20000 });
  await page.goto(HUB_URL);
  // The editor is an in-page hub state, not a :formatType route. Clicking the
  // real card heading invokes the hub's openFormat() handler.
  await openPosSaleTicketFromHub(page);
  const detailRequest = await detailRequestPromise;
  await expect(page.locator('#vendix-preview-iframe')).toBeVisible();
  await expect(page.locator('app-print-paper-panel input[name="copies"]')).toBeVisible();
  return detailRequest;
}

async function readSnapshot(page: Page, detailRequest: Request): Promise<{ url: string; authorization: string; snapshot: FormatSnapshot }> {
  const authorization = (await detailRequest.allHeaders()).authorization;
  expect(authorization, 'The authenticated editor GET must carry its real Authorization header').toBeTruthy();
  const url = detailRequest.url();
  const response = await page.request.get(url, { headers: { authorization } });
  expect(response.ok(), `Could not read print-format snapshot (${response.status()})`).toBeTruthy();
  const envelope = await response.json() as { data?: Partial<FormatSnapshot> };
  const data = envelope.data;
  expect(data, 'Print-format GET returned no data object').toBeTruthy();
  expect(typeof data?.is_active, 'Snapshot must include is_active').toBe('boolean');
  expect(typeof data?.gateway_enabled, 'Snapshot must include gateway_enabled').toBe('boolean');
  expect(data?.template_id === null || typeof data?.template_id === 'number', 'Snapshot must include nullable template_id').toBeTruthy();
  expect(
    data?.overrides === null || (typeof data?.overrides === 'object' && !Array.isArray(data.overrides)),
    'Snapshot must include raw overrides (null is a valid default and must be restored as null)',
  ).toBeTruthy();
  return {
    url,
    authorization,
    snapshot: {
      is_active: data!.is_active!,
      gateway_enabled: data!.gateway_enabled!,
      template_id: data!.template_id!,
      overrides: data!.overrides!,
    },
  };
}

async function restoreSnapshot(page: Page, url: string, authorization: string, snapshot: FormatSnapshot): Promise<void> {
  const response = await page.request.put(url, { headers: { authorization }, data: snapshot });
  expect(
    response.ok(),
    `CRITICAL: failed to restore print-format database snapshot (HTTP ${response.status()}); inspect this store's ${FORMAT_TYPE} configuration immediately.`,
  ).toBeTruthy();
}

test.describe.serial('Print-formats Editor — guarded local regression', () => {
  test.use({ ignoreHTTPSErrors: isLocalVendixOrigin() });
  test.beforeEach(async ({ page }) => login(page));

  test('renders the live canvas preview iframe with one real print container', async ({ page }) => {
    await openEditor(page);
    await expect(page.locator('.vendix-physical-paper-container')).toBeVisible({ timeout: 20000 });
    const preview = page.frameLocator('#vendix-preview-iframe');
    await expect(preview.locator('.print-container').first()).toBeVisible({ timeout: 20000 });
    await expect(preview.locator('.print-container')).toHaveCount(1);
  });

  test('saves 3 copies and reloads, restoring the original database snapshot afterwards', async ({ page }) => {
    const detailRequest = await openEditor(page);
    const { url, authorization, snapshot } = await readSnapshot(page, detailRequest);
    try {
      const copies = page.locator('app-print-paper-panel input[name="copies"]');
      await copies.fill('3');
      const saveResponse = page.waitForResponse((response) =>
        response.request().method() === 'PUT' && new URL(response.url()).pathname.endsWith(DETAIL_PATH),
      );
      await page.getByRole('button', { name: /guardar cambios/i }).click();
      const response = await saveResponse;
      expect(response.ok(), `Saving 3 copies failed with HTTP ${response.status()}`).toBeTruthy();

      await page.reload();
      await expect(page.getByRole('heading', { name: 'Ticket de Venta POS', exact: true })).toBeVisible();
      const reopenedDetail = page.waitForRequest(isFormatDetailRequest, { timeout: 20000 });
      await openPosSaleTicketFromHub(page);
      await reopenedDetail;
      await expect(page.locator('#vendix-preview-iframe')).toBeVisible();
      await expect(page.locator('app-print-paper-panel input[name="copies"]')).toHaveValue('3');
    } finally {
      await restoreSnapshot(page, url, authorization, snapshot);
    }
  });

  test('manual test-print honors draft copies 0/1/3/10 without saving and keeps one preview page', async ({ page }) => {
    await openEditor(page);
    const copies = page.locator('app-print-paper-panel input[name="copies"]');
    const writes: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'PUT' && new URL(request.url()).pathname.endsWith(DETAIL_PATH)) writes.push(request.postData() ?? '');
    });

    // Patch print() in each dynamically-created hidden iframe's own realm.
    // This intercepts the real DocumentPrintService path without opening a dialog.
    await page.evaluate(() => {
      const w = window as Window & { __vendixPrintCalls?: number };
      w.__vendixPrintCalls = 0;
      const patch = (iframe: HTMLIFrameElement) => {
        try {
          const printWindow = iframe.contentWindow as (Window & { __vendixPatchedPrint?: boolean }) | null;
          if (!printWindow || printWindow.__vendixPatchedPrint) return;
          printWindow.__vendixPatchedPrint = true;
          printWindow.print = () => {
            w.__vendixPrintCalls = (w.__vendixPrintCalls ?? 0) + 1;
          };
        } catch {
          // Cross-origin frames are irrelevant; the print service creates same-origin frames.
        }
      };
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          for (const node of Array.from(record.addedNodes)) {
            if (node instanceof HTMLIFrameElement) patch(node);
            if (node instanceof Element) node.querySelectorAll('iframe').forEach((iframe) => patch(iframe));
          }
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      (window as Window & { __vendixPrintObserver?: MutationObserver }).__vendixPrintObserver = observer;
    });

    for (const requested of [0, 1, 3, 10]) {
      const responsePromise = page.waitForResponse((response) =>
        response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith(`${DETAIL_PATH}/preview`),
      );
      await copies.fill(String(requested));
      const previewResponse = await responsePromise;
      expect(previewResponse.ok(), `Draft preview for ${requested} copies failed`).toBeTruthy();
      await expect(page.frameLocator('#vendix-preview-iframe').locator('.print-container')).toHaveCount(1);

      await page.evaluate(() => {
        (window as Window & { __vendixPrintCalls?: number }).__vendixPrintCalls = 0;
      });
      await page.locator('.vendix-canvas-card').getByRole('button', { name: /imprimir prueba/i }).click();
      const normalizedCopies = requested === 0 ? 1 : requested;
      await expect.poll(() => page.evaluate(() => (window as Window & { __vendixPrintCalls?: number }).__vendixPrintCalls ?? 0)).toBe(1);
      const hiddenDocument = await page.locator('iframe').evaluateAll((iframes) => {
        const frame = [...iframes].reverse().find((candidate) => candidate.id !== 'vendix-preview-iframe' &&
          (candidate as HTMLIFrameElement).contentDocument?.querySelector('.print-container')) as HTMLIFrameElement | undefined;
        const document = frame?.contentDocument;
        const result = {
          containers: document?.querySelectorAll('.print-container').length ?? 0,
          html: document?.querySelectorAll('html').length ?? 0,
          head: document?.querySelectorAll('head').length ?? 0,
          hasStyle: Boolean(document?.head.querySelector('style, link[rel="stylesheet"]')),
        };
        frame?.remove();
        return result;
      });
      expect(hiddenDocument.containers, `printed HTML should materialize ${normalizedCopies} body copies`).toBe(normalizedCopies);
      expect(hiddenDocument.html).toBe(1);
      expect(hiddenDocument.head).toBe(1);
      expect(hiddenDocument.hasStyle, 'printing should preserve the original document head/styles').toBeTruthy();
      await expect(page.frameLocator('#vendix-preview-iframe').locator('.print-container')).toHaveCount(1);
      expect(writes, 'draft printing must not persist editor changes').toHaveLength(0);
    }
    await page.evaluate(() => (window as Window & { __vendixPrintObserver?: MutationObserver }).__vendixPrintObserver?.disconnect());
    await expect(page.locator('app-print-paper-panel input[name="copies"]')).toHaveValue('10');
  });

  test('repairs a legacy missing non-fiscal disclaimer in browser draft only', async ({ page }) => {
    const detailRequestPromise = page.waitForRequest(isFormatDetailRequest);
    await page.route((url) => new URL(url).pathname.endsWith(DETAIL_PATH) && !new URL(url).pathname.endsWith('/preview'), async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const response = await route.fetch();
      const envelope = await response.json() as {
        data: { definition: { sections: Array<{ type?: string; enabled?: boolean; fields?: Array<{ id?: string; key?: string }> }> } };
      };
      const sections = envelope.data.definition.sections;
      let footer = sections.find((section) => section.type === 'footer');
      if (!footer) {
        footer = { type: 'footer', fields: [] };
        sections.push(footer);
      }
      // A disabled legacy footer containing the old field ID bypasses the
      // initial migration helper so the editor's explicit repair action is tested.
      footer.enabled = false;
      footer.fields = (footer.fields ?? []).filter((field) => field.key !== 'document.non_fiscal_disclaimer');
      footer.fields.push({ id: 'legacy_disclaimer', key: 'document.non_fiscal_disclaimer' });
      await route.fulfill({ response, json: envelope });
    });
    await page.goto(HUB_URL);
    await openPosSaleTicketFromHub(page);
    const detailRequest = await detailRequestPromise;
    expect((await detailRequest.allHeaders()).authorization, 'legacy simulation must be authenticated').toBeTruthy();
    await expect(page.locator('#vendix-preview-iframe')).toBeVisible();
    await expect(page.getByRole('button', { name: /anexo técnico/i })).toBeVisible();
    await page.getByRole('button', { name: /anexo técnico/i }).click();
    await expect(page.getByText(/leyenda no fiscal/i).first()).toBeVisible();
    await expect(page.getByText(/revisar leyenda del ticket/i)).toBeVisible();
    const repairedPreview = page.waitForResponse((response) =>
      response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith(`${DETAIL_PATH}/preview`),
    );
    await page.getByRole('button', { name: /revisar leyenda del ticket/i }).click();
    await expect(page.locator('app-print-paper-panel input[name="copies"]')).toBeVisible();
    await expect(page.getByText(/leyenda no fiscal/i).first()).toBeVisible();
    const repairedPreviewResponse = await repairedPreview;
    expect(repairedPreviewResponse.ok()).toBeTruthy();
    const previewBody = repairedPreviewResponse.request().postDataJSON() as {
      overrides?: { sections?: Array<{ type?: string; fields?: Array<{ id?: string; key?: string }> }> };
    };
    const repairedField = previewBody.overrides?.sections?.find((section) => section.type === 'footer')?.fields
      ?.find((field) => field.key === 'document.non_fiscal_disclaimer');
    expect(repairedField?.id, 'the browser draft must repair the canonical field ID required by backend validation').toBe('f_disclaimer');
    // The route fixture only changes this browser response. No malformed legacy
    // definition is ever PUT to the server or written into shared store data.
  });

  test('sad/brute UI boundary: auto-print off still allows manual print; decimals truncate without a write', async ({ page }) => {
    await openEditor(page);
    const writes: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'PUT' && new URL(request.url()).pathname.endsWith(DETAIL_PATH)) writes.push(request.postData() ?? '');
    });
    const autoPrint = page.locator('app-print-paper-panel input[type="checkbox"]');
    await expect(autoPrint).toBeEnabled();
    if (await autoPrint.isChecked()) await autoPrint.uncheck();
    const copies = page.locator('app-print-paper-panel input[name="copies"]');
    const previewResponse = page.waitForResponse((response) =>
      response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith(`${DETAIL_PATH}/preview`),
    );
    await copies.fill('3.9');
    await expect(copies).toHaveValue('3');
    expect((await previewResponse).ok()).toBeTruthy();
    await expect.poll(() => writes.length).toBe(0);
    await expect(page.locator('.vendix-canvas-card').getByRole('button', { name: /imprimir prueba/i })).toBeEnabled();
    await page.evaluate(() => {
      const w = window as Window & { __vendixPrintCalls?: number };
      w.__vendixPrintCalls = 0;
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          for (const node of Array.from(record.addedNodes)) {
            if (!(node instanceof Element)) continue;
            const frames = node instanceof HTMLIFrameElement ? [node] : Array.from(node.querySelectorAll('iframe'));
            for (const frame of frames) {
              try {
                const printWindow = frame.contentWindow as (Window & { __vendixPatchedPrint?: boolean }) | null;
                if (!printWindow || printWindow.__vendixPatchedPrint) continue;
                printWindow.__vendixPatchedPrint = true;
                printWindow.print = () => { w.__vendixPrintCalls = (w.__vendixPrintCalls ?? 0) + 1; };
              } catch { /* only same-origin print frames are patched */ }
            }
          }
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      (window as Window & { __vendixPrintObserver?: MutationObserver }).__vendixPrintObserver = observer;
    });
    await page.locator('.vendix-canvas-card').getByRole('button', { name: /imprimir prueba/i }).click();
    await expect.poll(() => page.evaluate(() => (window as Window & { __vendixPrintCalls?: number }).__vendixPrintCalls ?? 0)).toBe(1);
    await page.evaluate(() => (window as Window & { __vendixPrintObserver?: MutationObserver }).__vendixPrintObserver?.disconnect());
    await expect.poll(() => writes.length).toBe(0);
  });
});
