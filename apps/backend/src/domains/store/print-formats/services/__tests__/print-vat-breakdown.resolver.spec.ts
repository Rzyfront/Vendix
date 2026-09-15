/**
 * C.1 (CP-pos-exclusive-tax-double-charge, ADR-12) — unit tests del
 * resolvedor backend `resolvePrintsVatBreakdownForPrint`.
 *
 * El contrato que este archivo fija (los tres casos del paso):
 *   - `invoicing.state = 'SUSPENDED'`            → false
 *   - `'ACTIVE'` + responsabilidad indeterminada → false (fail-closed)
 *   - `'ACTIVE'` + responsable (O-48)            → true
 */
import { resolvePrintsVatBreakdownForPrint } from '../print-vat-breakdown.resolver';

function scopedStore(settings: any) {
  return { store_settings: { settings } };
}

describe('resolvePrintsVatBreakdownForPrint (C.1)', () => {
  it("invoicing.state = 'SUSPENDED' → false aunque haya O-48", () => {
    const org = { fiscal_scope: 'STORE' };
    const store = scopedStore({
      fiscal_status: { invoicing: { state: 'SUSPENDED' } },
      fiscal_data: { tax_responsibilities: ['O-48'] },
    });
    expect(resolvePrintsVatBreakdownForPrint(org, store)).toBe(false);
  });

  it("'ACTIVE' + responsabilidad indeterminada → false (fail-closed)", () => {
    const org = { fiscal_scope: 'STORE' };
    const store = scopedStore({
      fiscal_status: { invoicing: { state: 'ACTIVE' } },
      fiscal_data: {},
    });
    expect(resolvePrintsVatBreakdownForPrint(org, store)).toBe(false);
  });

  it("'ACTIVE' + responsable (O-48) → true", () => {
    const org = { fiscal_scope: 'STORE' };
    const store = scopedStore({
      fiscal_status: { invoicing: { state: 'ACTIVE' } },
      fiscal_data: { tax_responsibilities: ['O-48'] },
    });
    expect(resolvePrintsVatBreakdownForPrint(org, store)).toBe(true);
  });
});
