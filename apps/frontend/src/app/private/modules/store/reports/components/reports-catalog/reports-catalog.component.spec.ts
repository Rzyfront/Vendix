import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { ReportsCatalogComponent } from './reports-catalog.component';

/**
 * Agenda unificada F4: el catálogo de Reportes (Resumen y catálogo por
 * categoría) solo lista los reportes de las industrias activas de la tienda.
 * Se leen las señales sin pintar la plantilla.
 */
describe('ReportsCatalogComponent — reportes por industria', () => {
  const authStub = {
    storeIndustries: signal<string[]>(['retail']),
    visibleModules: signal<string[]>([]),
    isOwner: signal(false),
  };
  const MANAGER_PANEL = ['reports', 'hospitality', 'hospitality_reservations', 'reports_dispatch'];

  const create = (
    industries: string[],
    visibleModules: string[] = MANAGER_PANEL,
    isOwner = false,
  ) => {
    authStub.storeIndustries.set(industries);
    authStub.visibleModules.set(visibleModules);
    authStub.isOwner.set(isOwner);
    TestBed.configureTestingModule({
      imports: [ReportsCatalogComponent],
      providers: [provideRouter([]), { provide: AuthFacade, useValue: authStub }],
    });
    return TestBed.createComponent(ReportsCatalogComponent).componentInstance;
  };

  it('una tienda solo retail no ve la categoría ni los reportes de Hotelería', () => {
    const catalog = create(['retail']);
    expect(catalog.visibleCategories().map((c) => c.id)).not.toContain('hospitality');
    expect(catalog.filteredReports().some((r) => r.category === 'hospitality')).toBeFalse();
    expect(catalog.categoryCount('hospitality')).toBe(0);
  });

  it('una tienda con hotelería ve Hotelería con sus cinco reportes', () => {
    const catalog = create(['hospitality']);
    expect(catalog.visibleCategories().map((c) => c.id)).toContain('hospitality');
    expect(catalog.categoryCount('hospitality')).toBe(5);
    catalog.onCategoryChange('hospitality');
    expect(catalog.filteredReports().map((r) => r.title)).toContain('Cierre del día');
  });

  it('los reportes transversales están en ambos casos y el contador «de N» los cuenta', () => {
    const retail = create(['retail']);
    expect(retail.filteredReports().some((r) => r.id === 'sales-summary')).toBeTrue();
    expect(retail.totalAvailable()).toBe(retail.filteredReports().length);

    TestBed.resetTestingModule();
    const hotel = create(['hospitality']);
    expect(hotel.filteredReports().some((r) => r.id === 'sales-summary')).toBeTrue();
    expect(hotel.filteredReports().some((r) => r.id === 'cash-sessions')).toBeTrue();
  });

  it('en un hotel, un rol con Reportes pero sin hospitality_reservations no ve Hotelería', () => {
    const catalog = create(['hospitality'], ['reports', 'pos']);
    expect(catalog.visibleCategories().map((c) => c.id)).not.toContain('hospitality');
    expect(catalog.filteredReports().some((r) => r.category === 'hospitality')).toBeFalse();
    expect(catalog.totalAvailable()).toBe(catalog.filteredReports().length);
    // Lo transversal sigue.
    expect(catalog.filteredReports().some((r) => r.id === 'sales-summary')).toBeTrue();
  });

  it('el owner ve Hotelería aunque su panel no liste la key', () => {
    const catalog = create(['hospitality'], ['reports'], true);
    expect(catalog.categoryCount('hospitality')).toBe(5);
  });

  it('Despachos también respeta su key de panel (reports_dispatch), como su entrada del menú', () => {
    const catalog = create(['retail'], ['reports']);
    expect(catalog.visibleCategories().map((c) => c.id)).not.toContain('dispatch');
  });
});
