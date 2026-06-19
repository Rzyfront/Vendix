import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { AnalyticsCardComponent } from './analytics-card.component';
import { AnalyticsView, getCategoryById } from '../../config/analytics-registry';

const mockView: AnalyticsView = {
  key: 'sales_by_product',
  title: 'Por Producto',
  description: 'Ranking de productos',
  route: '/admin/analytics/sales/by-product',
  category: 'sales',
  icon: 'package',
};

describe('AnalyticsCardComponent', () => {
  let fixture: ComponentFixture<AnalyticsCardComponent>;
  let component: AnalyticsCardComponent;
  let router: Router;
  let navigateByUrlSpy: jasmine.Spy;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([])],
    });
    fixture = TestBed.createComponent(AnalyticsCardComponent);
    component = fixture.componentInstance;
    router = TestBed.inject(Router);
    navigateByUrlSpy = spyOn(router, 'navigateByUrl');
    fixture.componentRef.setInput('view', mockView);
    fixture.detectChanges();
  });

  it('renders the view title', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Por Producto');
  });

  it('exposes the category label via computed', () => {
    const expected = getCategoryById('sales')!.label;
    expect(component.categoryLabel()).toBe(expected);
  });

  it('exposes the category color via computed', () => {
    const expected = getCategoryById('sales')!.color;
    expect(component.categoryColor()).toBe(expected);
  });

  it('falls back to view.category when the category is unknown', () => {
    fixture.componentRef.setInput('view', { ...mockView, category: 'unknown' as never });
    fixture.detectChanges();
    expect(component.categoryLabel()).toBe('unknown');
    expect(component.categoryColor()).toBe('var(--color-primary)');
  });

  it('navigates to the view route on click', () => {
    component.onClick();
    expect(navigateByUrlSpy).toHaveBeenCalledOnceWith('/admin/analytics/sales/by-product');
  });
});
