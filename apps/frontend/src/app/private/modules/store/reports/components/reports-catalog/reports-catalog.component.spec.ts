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
  const authStub = { storeIndustries: signal<string[]>(['retail']) };

  const create = (industries: string[]) => {
    authStub.storeIndustries.set(industries);
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
});
