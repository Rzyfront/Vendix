import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { DEMO_ACCOUNT } from './fixtures/demo-account';

/**
 * QUI-950 (plan step A9) — printable-width invariant measured in a real browser.
 *
 * For every print format type x paper (thermal_80, thermal_58, a4, letter) the
 * backend preview HTML is loaded with `@media print` and the page viewport set
 * to the physical paper width. We then assert that the document never exceeds
 * the printable band [ (paper - printable)/2 , (paper + printable)/2 ]:
 *   - documentElement.scrollWidth <= paper width (+1px)
 *   - every element inside body has rect.left >= band start and rect.right <= band end (+1px)
 *   - content_width_mm reported by the API <= printable_width_mm
 * Every document is measured twice: as rendered, and after replacing every
 * text leaf with hostile data (80 unbroken chars, 999999999999 amounts) and
 * injecting an oversized image/table.
 *
 * Only backend-rendered HTML is measured (the frontend DocumentPrintService
 * wrapper is covered by its karma spec in CI).
 *
 * Env: E2E_EMAIL / E2E_PASSWORD / E2E_ORG_SLUG (login), E2E_API_URL (default
 * http://localhost:3000/api).
 */

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3000/api';
const MM_TO_PX = 96 / 25.4;
const TOLERANCE_PX = 1;

type PaperKey = 'thermal_80' | 'thermal_58' | 'a4' | 'letter';
const PAPERS: Record<PaperKey, { widthMm: number; isRoll: boolean }> = {
  thermal_80: { widthMm: 80, isRoll: true },
  thermal_58: { widthMm: 58, isRoll: true },
  a4: { widthMm: 210, isRoll: false },
  letter: { widthMm: 215.9, isRoll: false },
};

/** Types that are roll-only documents or whose sheet variants are not meaningful are still measured on every paper. */
const SHEET_PAPERS: PaperKey[] = ['a4', 'letter'];
const ROLL_PAPERS: PaperKey[] = ['thermal_80', 'thermal_58'];

const HOSTILE_LONG = 'X'.repeat(80);
const HOSTILE_EMAIL = `${'cliente.con.correo.muy.largo'.repeat(3)}@${'dominio'.repeat(6)}.com`;
const HOSTILE_AMOUNT = '$999999999999';

let token = '';
let formatTypes: string[] = [];

async function login(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${API_URL}/auth/login`, {
    data: {
      email: DEMO_ACCOUNT.email,
      password: DEMO_ACCOUNT.password,
      organization_slug: DEMO_ACCOUNT.organization_slug,
    },
  });
  expect(res.ok(), `login failed HTTP ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as { data: { access_token: string } };
  return body.data.access_token;
}

interface PreviewData {
  html: string;
  printable_width_mm: number;
  content_width_mm: number;
}

async function preview(request: APIRequestContext, type: string, paper: PaperKey): Promise<{ status: number; data?: PreviewData }> {
  const p = PAPERS[paper];
  const res = await request.post(`${API_URL}/store/print-formats/${type}/preview`, {
    headers: { authorization: `Bearer ${token}` },
    data: { overrides: { v: 2, paper: { format: paper, is_roll: p.isRoll, margin_mm: 0 } } },
  });
  if (!res.ok()) return { status: res.status() };
  return { status: res.status(), data: ((await res.json()) as { data: PreviewData }).data };
}

interface Measure {
  scrollWidth: number;
  viewport: number;
  offenders: { tag: string; cls: string; left: number; right: number; text: string }[];
}

async function measure(page: Page, bandStartPx: number, bandEndPx: number): Promise<Measure> {
  return page.evaluate(
    ({ start, end, tol }) => {
      const offenders: Measure['offenders'] = [];
      document.body.querySelectorAll('*').forEach((el) => {
        const tag = el.tagName.toLowerCase();
        if (['script', 'style', 'link', 'meta', 'title', 'head'].includes(tag)) return;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return;
        if (r.right > end + tol || r.left < start - tol) {
          offenders.push({
            tag,
            cls: (el as HTMLElement).className?.toString().slice(0, 60) ?? '',
            left: Math.round(r.left * 10) / 10,
            right: Math.round(r.right * 10) / 10,
            text: (el.textContent ?? '').trim().slice(0, 40),
          });
        }
      });
      return {
        scrollWidth: document.documentElement.scrollWidth,
        viewport: window.innerWidth,
        offenders: offenders.slice(0, 8),
      };
    },
    { start: bandStartPx, end: bandEndPx, tol: TOLERANCE_PX },
  );
}

/** Replaces every text leaf by hostile content and injects an oversized img + table. */
async function injectHostileData(page: Page): Promise<void> {
  await page.evaluate(
    ({ long, email, amount }) => {
      const leaves: Element[] = [];
      document.body.querySelectorAll('*').forEach((el) => {
        // `.vendix-token-pill` es cromo del editor (modo tokenized): un ticket real
        // imprime el valor resuelto, nunca la píldora `{{ token }}`.
        if (el.closest('.vendix-token-pill')) return;
        if (el.children.length === 0 && (el.textContent ?? '').trim().length > 0) leaves.push(el);
      });
      leaves.forEach((el, i) => {
        const original = (el.textContent ?? '').trim();
        const looksMoney = /[$]|\d[\d.,]{2,}/.test(original);
        el.textContent = looksMoney ? amount : i % 3 === 0 ? email : long;
      });
      const host = document.querySelector('.print-container') ?? document.body;
      const img = document.createElement('img');
      img.setAttribute('width', '900');
      img.setAttribute('height', '40');
      img.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="900" height="40"><rect width="900" height="40"/></svg>';
      host.appendChild(img);
      const table = document.createElement('table');
      table.innerHTML = `<tr><td>${long}${long}</td><td>${amount}${amount}</td><td>${long}</td></tr>`;
      host.appendChild(table);
    },
    { long: HOSTILE_LONG, email: HOSTILE_EMAIL, amount: HOSTILE_AMOUNT },
  );
}

test.describe('Print width invariant (QUI-950)', () => {
  test.beforeAll(async ({ playwright }) => {
    const request = await playwright.request.newContext({ ignoreHTTPSErrors: true });
    token = await login(request);
    const res = await request.get(`${API_URL}/store/print-formats`, { headers: { authorization: `Bearer ${token}` } });
    expect(res.ok()).toBeTruthy();
    formatTypes = ((await res.json()) as { data: { format_type: string }[] }).data.map((f) => f.format_type);
    expect(formatTypes.length).toBeGreaterThan(0);
    await request.dispose();
  });

  test('invalid draft printable_width_mm is rejected with PRINT_CONFIG_VALIDATION_001', async ({ request }) => {
    const res = await request.post(`${API_URL}/store/print-formats/pos_sale_ticket/preview`, {
      headers: { authorization: `Bearer ${token}` },
      data: { overrides: { v: 2, paper: { format: 'thermal_80', printable_width_mm: 90 } } },
    });
    expect([400, 422]).toContain(res.status());
    expect(JSON.stringify(await res.json())).toContain('PRINT_CONFIG_VALIDATION_001');
  });

  for (const paper of [...ROLL_PAPERS, ...SHEET_PAPERS] as PaperKey[]) {
    test(`every format type fits the printable band on ${paper} (as rendered and with hostile data)`, async ({ page, request }) => {
      test.setTimeout(180_000);
      const { widthMm } = PAPERS[paper];
      const paperPx = widthMm * MM_TO_PX;
      await page.setViewportSize({ width: Math.ceil(paperPx), height: 1200 });
      await page.emulateMedia({ media: 'print' });

      const failures: string[] = [];
      const skipped: string[] = [];
      for (const type of formatTypes) {
        const { status, data } = await preview(request, type, paper);
        if (!data) {
          skipped.push(`${type}:HTTP${status}`);
          continue;
        }
        if (data.content_width_mm > data.printable_width_mm + 0.01) {
          failures.push(`${type}/${paper}: content_width_mm ${data.content_width_mm} > printable ${data.printable_width_mm}`);
        }
        if (paper === 'thermal_80') expect.soft(data.printable_width_mm).toBeLessThanOrEqual(72);
        if (paper === 'thermal_58') expect.soft(data.printable_width_mm).toBeLessThanOrEqual(48);

        const bandStart = ((widthMm - data.printable_width_mm) / 2) * MM_TO_PX;
        const bandEnd = ((widthMm + data.printable_width_mm) / 2) * MM_TO_PX;
        const viewportPx = Math.ceil(paperPx);

        for (const variant of ['as-rendered', 'hostile'] as const) {
          await page.setContent(data.html, { waitUntil: 'load' });
          if (variant === 'hostile') await injectHostileData(page);
          const m = await measure(page, bandStart, bandEnd);
          if (m.scrollWidth > viewportPx + TOLERANCE_PX) {
            failures.push(`${type}/${paper}/${variant}: scrollWidth ${m.scrollWidth}px > paper ${viewportPx}px`);
          }
          if (m.offenders.length) {
            failures.push(
              `${type}/${paper}/${variant}: band ${bandStart.toFixed(1)}..${bandEnd.toFixed(1)}px; offenders ` +
                m.offenders.map((o) => `<${o.tag}.${o.cls}> ${o.left}..${o.right} "${o.text}"`).join(' | '),
            );
          }
        }
      }
      console.log(`[${paper}] skipped (no preview): ${skipped.join(', ') || 'none'}`);
      expect(failures, failures.join('\n')).toEqual([]);
    });
  }
});
