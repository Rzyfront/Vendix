import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AnalyticsTabBarComponent } from './analytics-tab-bar.component';
import {
  AnalyticsCategoryId,
  AnalyticsView,
  getViewsByCategory,
} from '../../config/analytics-registry';

describe('AnalyticsTabBarComponent', () => {
  let fixture: ComponentFixture<AnalyticsTabBarComponent>;
  let component: AnalyticsTabBarComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([])],
    });
    fixture = TestBed.createComponent(AnalyticsTabBarComponent);
    component = fixture.componentInstance;
  });

  /**
   * Helper: setea el input `categoryId` y dispara change detection.
   * Igual que `analytics-category-chips.component.spec.ts` — usa
   * `componentRef.setInput` porque `categoryId` es `input.required<T>()`.
   */
  function renderWith(categoryId: AnalyticsCategoryId): void {
    fixture.componentRef.setInput('categoryId', categoryId);
    fixture.detectChanges();
  }

  it('maps AnalyticsView → AnalyticsTabView with the expected shape for "sales"', () => {
    renderWith('sales');

    const expected_views = getViewsByCategory('sales');
    expect(component.tabs().length).toBe(expected_views.length);

    const first_view = expected_views[0];
    const first_tab = component.tabs()[0];
    expect(first_tab).toEqual({
      id: first_view.key,
      label: first_view.title,
      icon: first_view.icon,
      route: first_view.route,
    });
  });

  it('returns the same tab count as getViewsByCategory for representative categories', () => {
    const categories: AnalyticsCategoryId[] = [
      'overview',
      'sales',
      'inventory',
      'products',
      'purchases',
      'customers',
      'reviews',
      'financial',
    ];

    for (const category_id of categories) {
      renderWith(category_id);
      expect(component.tabs().length).withContext(`category=${category_id}`).toBe(
        getViewsByCategory(category_id).length,
      );
    }
  });

  it('renders one <a role="tab"> per tab in the DOM', () => {
    renderWith('sales');

    const anchors = fixture.nativeElement.querySelectorAll('a[role="tab"]') as NodeListOf<HTMLAnchorElement>;
    expect(anchors.length).toBe(getViewsByCategory('sales').length);

    // Cada anchor debe tener su `href` apuntando a la ruta del tab.
    const first_view: AnalyticsView = getViewsByCategory('sales')[0];
    expect(anchors[0].getAttribute('href')).toBe(first_view.route);
  });

  it('renders <nav role="tablist"> with the default aria-label', () => {
    renderWith('overview');

    const nav = fixture.nativeElement.querySelector('nav[role="tablist"]') as HTMLElement;
    expect(nav).toBeTruthy();
    expect(nav.getAttribute('aria-label')).toBe('Navegación de analíticas');
  });

  it('overrides ariaLabel via the signal input', () => {
    fixture.componentRef.setInput('categoryId', 'overview');
    fixture.componentRef.setInput('ariaLabel', 'Ir a sección de resumen');
    fixture.detectChanges();

    const nav = fixture.nativeElement.querySelector('nav[role="tablist"]') as HTMLElement;
    expect(nav.getAttribute('aria-label')).toBe('Ir a sección de resumen');
  });

  it('re-evaluates tabs() when categoryId changes', () => {
    renderWith('sales');
    const sales_ids = component.tabs().map((t) => t.id);

    renderWith('inventory');
    const inventory_ids = component.tabs().map((t) => t.id);

    // Deben ser listas distintas y corresponderse con cada categoría.
    expect(sales_ids).not.toEqual(inventory_ids);
    expect(sales_ids).toEqual(getViewsByCategory('sales').map((v) => v.key));
    expect(inventory_ids).toEqual(getViewsByCategory('inventory').map((v) => v.key));
  });
});