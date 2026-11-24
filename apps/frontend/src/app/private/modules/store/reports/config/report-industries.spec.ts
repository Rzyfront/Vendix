import { REPORT_DEFINITIONS } from './report-registry';
import {
  isReportCategoryVisibleForIndustries,
  isReportVisibleForIndustries,
  reportCategoriesForIndustries,
  reportIndustryRule,
  reportsForIndustries,
} from './report-industries';

const HOTEL_IDS = [
  'hotel-night-audit',
  'hotel-performance',
  'hotel-pickup',
  'hotel-cancellations',
  'hotel-fontur',
];

const TRANSVERSAL_IDS = [
  'overview-summary',
  'sales-summary',
  'cash-sessions',
  'inventory-overview',
  'purchase-summary',
  'customer-summary',
  'trial-balance',
  'payroll-summary',
  'payments-list',
];

const ids = (industries: string[] | null) =>
  reportsForIndustries(industries).map((r) => r.id);

describe('report-industries (agenda unificada F4)', () => {
  it('registra los cinco reportes de hotel en la categoría Hotelería', () => {
    const hotel = REPORT_DEFINITIONS.filter((r) => r.category === 'hospitality');
    expect(hotel.map((r) => r.id)).toEqual(HOTEL_IDS);
    for (const report of hotel) {
      expect(report.route).toBe(`/admin/reports/hospitality/${report.id}`);
    }
  });

  it('una tienda solo retail no ve reportes de hotel ni la categoría Hotelería', () => {
    const visible = ids(['retail']);
    for (const id of HOTEL_IDS) expect(visible).not.toContain(id);
    expect(isReportCategoryVisibleForIndustries('hospitality', ['retail'])).toBeFalse();
    expect(reportCategoriesForIndustries(['retail']).map((c) => c.id)).not.toContain(
      'hospitality',
    );
  });

  it('una tienda con hotelería ve los reportes de hotel', () => {
    const visible = ids(['hospitality']);
    for (const id of HOTEL_IDS) expect(visible).toContain(id);
    expect(isReportCategoryVisibleForIndustries('hospitality', ['hospitality'])).toBeTrue();
  });

  it('los reportes transversales se ven en todas las industrias', () => {
    for (const industries of [['retail'], ['hospitality'], ['restaurant'], ['service'], ['gym'], []]) {
      const visible = ids(industries);
      for (const id of TRANSVERSAL_IDS) expect(visible).toContain(id);
    }
  });

  it('una tienda multindustria ve la unión', () => {
    const visible = ids(['retail', 'hospitality']);
    expect(visible).toContain('hotel-performance');
    expect(visible).toContain('dispatch-remisiones');
  });

  it('despachos sigue la regla de reports_dispatch (solo retail)', () => {
    expect(isReportCategoryVisibleForIndustries('dispatch', ['retail'])).toBeTrue();
    expect(isReportCategoryVisibleForIndustries('dispatch', ['hospitality'])).toBeFalse();
  });

  it('propinas por mesero solo en restaurante; consumo de insumos en restaurante y manufactura', () => {
    const tips = { id: 'sales-tips-by-waiter', category: 'sales' as const };
    const ingredients = { id: 'inventory-ingredient-consumption', category: 'inventory' as const };
    expect(isReportVisibleForIndustries(tips, ['retail'])).toBeFalse();
    expect(isReportVisibleForIndustries(tips, ['restaurant'])).toBeTrue();
    expect(isReportVisibleForIndustries(ingredients, ['retail'])).toBeFalse();
    expect(isReportVisibleForIndustries(ingredients, ['manufacturing'])).toBeTrue();
    // La regla del reporte gana sobre la de su categoría (ventas = 'all').
    expect(reportIndustryRule(tips)).toEqual(['restaurant']);
  });

  it('una tienda sin industrias se lee como retail (igual que el menú)', () => {
    expect(ids([])).toEqual(ids(['retail']));
    expect(ids(null)).toEqual(ids(['retail']));
  });
});
