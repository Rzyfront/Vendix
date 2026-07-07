/**
 * Smoke tests para `getQuickLinks` (sales-views).
 *
 * El catálogo de vistas del módulo Ventas es la única fuente de verdad
 * para tabs (ScrollableTabs) y quick links (AnalyticsViewsCard). Si
 * rompe la lógica de exclusión, una vista puede aparecer dos veces o
 * no aparecer nunca.
 */
import { SALES_VIEWS, getQuickLinks } from './sales-views';

describe('SALES_VIEWS catalog', () => {
  it('tiene exactamente 5 vistas (orden estable)', () => {
    expect(SALES_VIEWS).toHaveLength(5);
  });

  it('todas las vistas tienen keys únicos', () => {
    const keys = SALES_VIEWS.map((v) => v.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('solo "sales_summary" y "sales_by_product" están disponibles hoy', () => {
    const available = SALES_VIEWS.filter((v) => v.available);
    const keys = available.map((v) => v.key).sort();
    expect(keys).toEqual(['sales_by_product', 'sales_summary']);
  });

  it('cada vista tiene los campos requeridos', () => {
    for (const v of SALES_VIEWS) {
      expect(v.key).toBeTruthy();
      expect(v.title).toBeTruthy();
      expect(v.description).toBeTruthy();
      expect(v.icon).toBeTruthy();
      expect(v.route).toMatch(/^\/analytics\/sales/);
      expect(typeof v.available).toBe('boolean');
      expect(v.color.bg).toMatch(/^#[0-9a-f]{6}$/i);
      expect(v.color.fg).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe('getQuickLinks', () => {
  it('excluye la vista indicada y las no disponibles', () => {
    const links = getQuickLinks('sales_by_product');
    // "sales_by_product" es la actual → excluida
    // "sales_by_category", "sales_by_customer", "sales_by_payment" → available=false → excluidas
    // Solo "sales_summary" debe quedar (available=true)
    expect(links.map((v) => v.key)).toEqual(['sales_summary']);
  });

  it('excluyendo sales_summary → solo queda sales_by_product (disponible)', () => {
    const links = getQuickLinks('sales_summary');
    expect(links.map((v) => v.key)).toEqual(['sales_by_product']);
  });

  it('nunca retorna vistas no disponibles (filter por available=true)', () => {
    const links = getQuickLinks('sales_summary');
    expect(links.every((v) => v.available)).toBe(true);
  });

  it('excluyendo una vista no disponible → no aparece en el resultado', () => {
    const links = getQuickLinks('sales_by_category');
    expect(links.find((v) => v.key === 'sales_by_category')).toBeUndefined();
  });
});
