import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { CatalogService, EcommerceProduct } from '../../private/modules/ecommerce/services/catalog.service';
import { CurrencyFormatService } from '../../shared/pipes/currency';
import { AppPageProductsViewComponent } from './app-page-products-view.component';
import { AppPageProductItem, orderProductsByIds, resolveProductCardPrice } from './app-page-products.util';

const item = (id: number, name: string, over: Partial<AppPageProductItem> = {}): AppPageProductItem => ({
  id,
  slug: `prod-${id}`,
  name,
  image_url: `https://cdn.vendix.test/${id}.jpg`,
  final_price: id * 10000,
  regular_final_price: null,
  is_on_sale: false,
  variants: [],
  ...over,
});

describe('AppPageProductsViewComponent', () => {
  let fixture: ComponentFixture<AppPageProductsViewComponent>;
  let catalogSpy: jasmine.SpyObj<CatalogService>;

  beforeEach(() => {
    catalogSpy = jasmine.createSpyObj<CatalogService>('CatalogService', ['getProducts']);
    TestBed.configureTestingModule({
      imports: [AppPageProductsViewComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: CatalogService, useValue: catalogSpy },
        {
          provide: CurrencyFormatService,
          useValue: {
            currencyCode: signal('COP'),
            format: (v: number) => `$${v}`,
            loadCurrency: () => {},
          },
        },
      ],
    });
  });

  const el = () => fixture.nativeElement as HTMLElement;

  it('selección manual respeta el orden exacto de product_ids y el límite de 50', () => {
    const many = Array.from({ length: 55 }, (_, i) => item(i + 1, `P${i + 1}`));
    const ids = Array.from({ length: 55 }, (_, i) => 55 - i);
    const ordered = orderProductsByIds(many, ids);
    expect(ordered.length).toBe(50);
    expect(ordered[0].id).toBe(55);
    expect(ordered[49].id).toBe(6);

    fixture = TestBed.createComponent(AppPageProductsViewComponent);
    fixture.componentRef.setInput('selection', 'manual');
    fixture.componentRef.setInput('productIds', [30, 10, 20]);
    fixture.componentRef.setInput('preview', true);
    fixture.componentRef.setInput('previewItems', [item(10, 'Uno'), item(20, 'Dos'), item(30, 'Tres')]);
    fixture.detectChanges();

    const cards = Array.from(el().querySelectorAll('[data-testid="product-block-card"]'));
    expect(cards.map((c) => c.getAttribute('data-product-id'))).toEqual(['30', '10', '20']);
    expect(catalogSpy.getProducts).not.toHaveBeenCalled();
  });

  it('tarjetas con show_variants muestran selector (nombre y precio) y elegir variante actualiza el precio mostrado', () => {
    const withVariants = item(1, 'Crema hidratante', {
      final_price: 50000,
      variants: [
        { id: 101, name: '250 ml', final_price: 50000, regular_final_price: null, is_on_sale: false },
        { id: 102, name: '500 ml', final_price: 78000, regular_final_price: 92000, is_on_sale: true },
      ],
    });

    fixture = TestBed.createComponent(AppPageProductsViewComponent);
    fixture.componentRef.setInput('selection', 'manual');
    fixture.componentRef.setInput('productIds', [1]);
    fixture.componentRef.setInput('showVariants', true);
    fixture.componentRef.setInput('preview', true);
    fixture.componentRef.setInput('previewItems', [withVariants]);
    fixture.detectChanges();

    const priceEl = () => el().querySelector('[data-testid="product-card-price"]')?.textContent?.trim();
    expect(priceEl()).toBe('$50000');

    const variantBtn = el().querySelector('[data-testid="variant-option-102"]') as HTMLButtonElement;
    expect(variantBtn.textContent).toContain('500 ml');
    expect(variantBtn.textContent).toContain('$78000');
    expect(variantBtn.getAttribute('aria-pressed')).toBe('false');

    variantBtn.click();
    fixture.detectChanges();

    expect(variantBtn.getAttribute('aria-pressed')).toBe('true');
    expect(priceEl()).toBe('$78000');
    expect(el().querySelector('[data-testid="product-card-compare-at"]')?.textContent?.trim()).toBe('$92000');
  });

  it('en página pública carga productos con include_variants y actualiza el precio igual que en vista previa', async () => {
    catalogSpy.getProducts.and.returnValue(
      of({
        success: true,
        data: [
          {
            id: 2,
            slug: 'jabon',
            name: 'Jabón artesanal',
            final_price: 15000,
            image_url: null,
            variants: [{ id: 201, name: 'Lavanda', sku: 'LV', final_price: 18500, is_on_sale: false, is_available: true }],
          } as unknown as EcommerceProduct,
          {
            id: 1,
            slug: 'aceite',
            name: 'Aceite',
            final_price: 30000,
            image_url: null,
            variants: [],
          } as unknown as EcommerceProduct,
        ],
        meta: { total: 2, page: 1, limit: 2, total_pages: 1 },
      }),
    );

    fixture = TestBed.createComponent(AppPageProductsViewComponent);
    fixture.componentRef.setInput('selection', 'manual');
    fixture.componentRef.setInput('productIds', [2, 1]);
    fixture.componentRef.setInput('showVariants', true);
    fixture.componentRef.setInput('layout', 'list');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(catalogSpy.getProducts).toHaveBeenCalledWith({ ids: '2,1', limit: 2, include_variants: true });
    expect(el().querySelector('[data-testid="products-layout-list"]')).not.toBeNull();
    const cards = Array.from(el().querySelectorAll('[data-testid="product-block-card"]'));
    expect(cards.map((c) => c.getAttribute('data-product-id'))).toEqual(['2', '1']);

    // Al elegir la variante de Jabón, el precio cambia de $15000 a $18500
    (el().querySelector('[data-testid="variant-option-201"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(cards[0].querySelector('[data-testid="product-card-price"]')?.textContent?.trim()).toBe('$18500');
  });

  it('renderiza los diseños grid, list y carousel y nunca inyecta HTML libre', () => {
    const xssItem = item(1, '<b>Oferta</b>', { final_price: 20000 });
    for (const layout of ['grid', 'list', 'carousel'] as const) {
      fixture = TestBed.createComponent(AppPageProductsViewComponent);
      fixture.componentRef.setInput('layout', layout);
      fixture.componentRef.setInput('preview', true);
      fixture.componentRef.setInput('previewItems', [xssItem, item(2, 'Otro')]);
      fixture.detectChanges();

      expect(el().querySelector(`[data-testid="products-layout-${layout}"]`)).not.toBeNull();
      expect(el().querySelector('b')).toBeNull();
      expect(el().textContent).toContain('<b>Oferta</b>');
    }

    // Verifica resolución de precio cuando no hay variante elegida vs elegida
    const resolved = resolveProductCardPrice(
      item(1, 'Test', {
        final_price: 100,
        variants: [{ id: 5, name: 'XL', final_price: 140, regular_final_price: 160, is_on_sale: true }],
      }),
      5,
    );
    expect(resolved).toEqual({ price: 140, compareAt: 160, onSale: true });
  });
});
