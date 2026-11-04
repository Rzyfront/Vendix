import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import {
  PLAN_GATE_EXEMPT_API_PREFIXES,
  SALE_FLOW_API_PREFIXES,
  isSaleFlow,
  mappedPlanModuleForApiPath,
  planModuleForApiPath,
} from './plan-modules';

/**
 * «Venta blindada» (PR #1080): the module paywall never blocks a sale.
 * Inventory with every stage: docs/access/venta-endpoints.md.
 */
const REPO_ROOT = join(__dirname, '../../../../..');
const FRONT = 'apps/frontend/src/app';

/**
 * Every browser call of the sale path that sits under a gated prefix, with the
 * file that makes it and a needle proving the call is still there. A sale
 * endpoint that the plan layer could refuse fails `is never gated`.
 */
const GATED_SALE_CALLS: ReadonlyArray<{
  call: string;
  file: string;
  needle: string;
}> = [
  {
    call: 'POST /api/store/withholding-tax/preview',
    file: `${FRONT}/private/modules/store/withholding-tax/services/withholding-tax.service.ts`,
    needle: '/store/withholding-tax/preview',
  },
  {
    call: 'GET /api/store/invoicing/pos/orders/41/fiscal-status',
    file: `${FRONT}/private/modules/store/pos/services/pos-fiscal.service.ts`,
    needle: '/fiscal-status',
  },
  {
    call: 'POST /api/store/invoicing/pos/orders/41/emit',
    file: `${FRONT}/private/modules/store/pos/services/pos-fiscal.service.ts`,
    needle: '/emit`',
  },
  {
    call: 'GET /api/store/invoicing/dian-config/emission-status',
    file: `${FRONT}/private/modules/store/pos/components/pos-holder-warning.component.ts`,
    needle: 'emission-status',
  },
  {
    call: 'GET /api/store/invoicing/holder-check?customer_id=5',
    file: `${FRONT}/private/modules/store/invoicing/services/invoicing.service.ts`,
    needle: "'holder-check'",
  },
  {
    call: 'GET /api/store/invoicing/dian-config',
    file: `${FRONT}/private/modules/store/pos/components/pos-order-confirmation.component.ts`,
    needle: 'loadDianConfigs',
  },
  {
    call: 'GET /api/store/invoicing/uvt-threshold',
    file: `${FRONT}/private/modules/store/invoicing/services/invoicing.service.ts`,
    needle: "'uvt-threshold'",
  },
  {
    call: 'GET /api/store/invoicing/88/notes',
    file: `${FRONT}/private/modules/store/orders/pages/order-details/order-details-page.component.ts`,
    needle: '/notes',
  },
  {
    call: 'POST /api/store/invoicing/orders/41/emit',
    file: `${FRONT}/private/modules/store/orders/pages/order-details/order-details-page.component.ts`,
    needle: '/emit',
  },
  {
    call: 'GET /api/store/invoicing/88/pdf',
    file: `${FRONT}/private/modules/store/orders/pages/order-details/order-details-page.component.ts`,
    needle: '/pdf',
  },
  {
    call: 'POST /api/store/invoicing/financial-accounts/7/emit',
    file: `${FRONT}/private/modules/store/restaurant-ops/tables/components/split-accounts-panel/split-accounts-panel.component.ts`,
    needle: 'emitFinancialAccount(',
  },
];

/** Sale endpoints outside any gated prefix: the plan layer never sees them. */
const UNGATED_SALE_CALLS: readonly string[] = [
  '/api/store/products',
  '/api/store/inventory/stock-levels/sourcing-suggestion',
  '/api/store/taxes',
  '/api/store/customers/resolve',
  '/api/store/promotions/active',
  '/api/store/coupons/validate',
  '/api/store/wallets/5',
  '/api/store/payments/payment-methods',
  '/api/store/payments/pos',
  '/api/store/payments/pos/confirm-wompi-payment/9',
  '/api/store/orders/41/flow/pay',
  '/api/store/orders/41/flow/credit-payment',
  '/api/store/cash-registers/sessions/active',
  '/api/store/orders/bulk/cash-session-finish',
  '/api/store/print-formats/render',
  '/api/store/kitchen-fire',
  '/api/store/table-sessions/3/close',
  '/api/store/layaway',
  '/api/store/settings',
  '/api/shipping/calculate',
  '/api/ecommerce/cart',
  '/api/ecommerce/checkout',
  '/api/ecommerce/checkout/confirm-wompi-payment/9',
];

/** Frontend surfaces where a sale runs. */
const SALE_SURFACES = [
  `${FRONT}/private/modules/store/pos`,
  `${FRONT}/private/modules/store/orders/pages/order-details`,
  `${FRONT}/private/modules/store/orders/components/order-payment-modal`,
  `${FRONT}/private/modules/store/restaurant-ops/tables/components/split-accounts-panel`,
  `${FRONT}/private/modules/ecommerce`,
];

/**
 * Imports a sale surface makes from a module the plan can lock, reviewed one
 * by one: either types/pure helpers, or a service whose calls are all in
 * `GATED_SALE_CALLS`. A new import fails until someone checks its endpoints.
 */
const REVIEWED_GATED_IMPORTS: readonly string[] = [
  'orders/pages/order-details/order-details-page.component.ts -> invoicing/components/invoice-detail/invoice-detail.component',
  'orders/pages/order-details/order-details-page.component.ts -> invoicing/components/invoice-detail/invoice-fiscal-status.util',
  'orders/pages/order-details/order-details-page.component.ts -> invoicing/interfaces/invoice.interface',
  'orders/pages/order-details/order-details-page.component.ts -> invoicing/services/invoicing.service',
  'orders/pages/order-details/order-details-page.component.ts -> invoicing/state/actions/invoicing.actions',
  'orders/pages/order-details/refund-note-mapping.util.ts -> invoicing/interfaces/invoice.interface',
  'restaurant-ops/tables/components/split-accounts-panel/split-accounts-panel.component.ts -> invoicing/services/invoicing.service',
  'pos/components/pos-custom-item-modal/pos-custom-item-modal.component.ts -> invoicing/components/invoice-create/invoice-custom-item-modal.component',
  'pos/components/pos-custom-item-modal/pos-custom-item-modal.component.ts -> invoicing/utils/invoice-line-math',
  'pos/components/pos-holder-warning.component.ts -> invoicing/services/invoicing.service',
  'pos/components/pos-order-confirmation.component.ts -> invoicing/components/invoicing-not-configured/invoicing-not-configured.component',
  'pos/components/pos-order-confirmation.component.ts -> invoicing/services/invoice-emit-readiness.service',
  'pos/components/pos-order-confirmation.component.ts -> invoicing/state/actions/invoicing.actions',
  'pos/components/pos-order-confirmation.component.ts -> invoicing/state/selectors/invoicing.selectors',
  'pos/components/pos-order-confirmation.component.ts -> invoicing/utils/invoice-emit-requirements',
  'pos/models/cart.model.ts -> withholding-tax/interfaces/withholding.interface',
  'pos/services/pos-cart.service.ts -> withholding-tax/interfaces/withholding.interface',
  'pos/services/pos-cart.service.ts -> withholding-tax/services/withholding-tax.service',
  'pos/services/pos-fiscal.service.ts -> invoicing/services/invoice-emit-readiness.service',
];

const GATED_MODULE_DIRS =
  /from '[^']*\/(invoicing|withholding-tax|accounting|exogenous|payroll|fiscal|taxes\/ica)\/([^']*)'/g;

function tsFiles(dir: string): string[] {
  const abs = join(REPO_ROOT, dir);
  return readdirSync(abs).flatMap((name) => {
    const full = join(abs, name);
    if (statSync(full).isDirectory()) return tsFiles(relative(REPO_ROOT, full));
    return name.endsWith('.ts') && !name.endsWith('.spec.ts') ? [full] : [];
  });
}

const pathOf = (call: string) => call.split(' ')[1];

describe('sale flow — contract: no sale endpoint is under a blockable module', () => {
  it.each(GATED_SALE_CALLS.map((c) => [c.call, c]))(
    '%s is a sale endpoint and is never gated',
    (_call, { call }) => {
      const path = pathOf(call);
      // It IS under a gated prefix (otherwise it belongs in UNGATED_SALE_CALLS)…
      expect(mappedPlanModuleForApiPath(path)).not.toBeNull();
      // …and the single decision point calls it a sale, so nothing gates it.
      expect(isSaleFlow({ apiPath: path })).toBe(true);
      expect(planModuleForApiPath(path)).toBeNull();
    },
  );

  it.each(GATED_SALE_CALLS.map((c) => [c.call, c]))(
    '%s is still called where the inventory says',
    (_call, { file, needle }) => {
      const source = readFileSync(join(REPO_ROOT, file), 'utf8');
      expect({ file, found: source.includes(needle) }).toEqual({ file, found: true });
    },
  );

  it.each(UNGATED_SALE_CALLS)('%s is outside the plan layer', (path) => {
    expect(planModuleForApiPath(path)).toBeNull();
  });

  it('every sale prefix is exempt from the plan layer', () => {
    for (const prefix of SALE_FLOW_API_PREFIXES) {
      expect(PLAN_GATE_EXEMPT_API_PREFIXES).toContain(prefix);
    }
  });

  it('a sale surface imports nothing new from a module the plan can lock', () => {
    const found = new Set<string>();
    for (const surface of SALE_SURFACES) {
      for (const file of tsFiles(surface)) {
        const source = readFileSync(file, 'utf8');
        const rel = relative(join(REPO_ROOT, FRONT, 'private/modules/store'), file);
        for (const match of source.matchAll(GATED_MODULE_DIRS)) {
          found.add(`${rel} -> ${match[1]}/${match[2]}`);
        }
      }
    }
    const unreviewed = [...found].filter((f) => !REVIEWED_GATED_IMPORTS.includes(f));
    expect(unreviewed).toEqual([]);
  });
});

describe('sale flow — the exemption stays narrow', () => {
  it.each([
    ['/api/store/withholding-tax/concepts', 'accounting_withholding_tax'],
    ['/api/store/withholding-tax/calculate', 'accounting_withholding_tax'],
    ['/api/store/invoicing', 'invoicing'],
    ['/api/store/invoicing/stats', 'invoicing'],
    ['/api/store/invoicing/dian-config/5', 'invoicing_dian_config'],
    ['/api/store/invoicing/dian-config/5/test-connection', 'invoicing_dian_config'],
    ['/api/store/invoicing/88/pdf/regenerate', 'invoicing'],
    ['/api/store/invoicing/abc/notes', 'invoicing'],
    ['/api/store/invoicing/credit-notes', 'invoicing'],
    ['/api/store/accounting/journal-entries', 'accounting_journal_entries'],
  ])('%s stays gated under %s', (path, key) => {
    expect(isSaleFlow({ apiPath: path })).toBe(false);
    expect(planModuleForApiPath(path)).toBe(key);
  });
});

describe('sale flow — isSaleFlow, the single decision point', () => {
  it.each([
    [{ apiPath: 'https://api.vendix.com/api/store/withholding-tax/preview' }, true],
    [{ apiPath: '/api/store/invoicing/dian-config?x=1' }, true],
    [{ apiPath: '/API/Store/Invoicing/12/Notes/' }, true],
    [{ uiRoute: '/admin/pos' }, true],
    [{ uiRoute: '/admin/pos?tab=cart' }, true],
    [{ uiRoute: '/admin/orders/41' }, true],
    [{ uiRoute: '/checkout' }, true],
    [{ uiRoute: '/admin/orders' }, false],
    [{ uiRoute: '/admin/posx' }, false],
    [{ uiRoute: '/admin/invoicing/invoices' }, false],
    [{ apiPath: '/api/store/invoicing/invoices', uiRoute: '/admin/pos' }, true],
    [{ apiPath: '/api/store/invoicing/invoices', uiRoute: '/admin/accounting' }, false],
    [{}, false],
  ])('%j → %s', (context, expected) => {
    expect(isSaleFlow(context)).toBe(expected);
  });
});
