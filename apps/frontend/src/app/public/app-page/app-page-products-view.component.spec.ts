import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { CatalogService, EcommerceProduct } from '../../private/modules/ecommerce/services/catalog.service';
import { CurrencyFormatService } from '../../shared/pipes/currency';
import { AppPageProductsViewComponent } from './app-page-products-view.component';
import { AppPageProductItem, mapEcommerceProductToItem, orderProductsByIds } from './app-page-products.util';

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

  it('renderiza los diseños grid, list y carousel con plantilla unificada, aria-live en precio y sin HTML libre', () => {
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
      const priceRow = el().querySelector('[data-testid="product-card-price-row"]');
      expect(priceRow?.getAttribute('aria-live')).toBe('polite');
      expect(priceRow?.getAttribute('aria-atomic')).toBe('true');
    }
  });

  it('aplica promoción plana activa desde el catálogo público e ignora el descuento unitario en promociones por cantidad', () => {
    const flatMapped = mapEcommerceProductToItem({
      id: 1,
      slug: 'crema',
      name: 'Crema',
      final_price: 50000,
      regular_final_price: 50000,
      image_url: null,
      active_promotion: {
        id: 1,
        name: 'Promo 20%',
        type: 'percentage',
        scope: 'product',
        promotional_price: 40000,
        badge_label: '-20% OFF',
        priority: 1,
      },
    } as unknown as EcommerceProduct);
    expect(flatMapped).toEqual(
      jasmine.objectContaining({
        final_price: 40000,
        regular_final_price: 50000,
        is_on_sale: true,
      }),
    );

    const tieredMapped = mapEcommerceProductToItem({
      id: 2,
      slug: 'jabon',
      name: 'Jabón',
      final_price: 20000,
      regular_final_price: 20000,
      image_url: null,
      active_promotion: {
        id: 2,
        name: 'Lleva 3',
        type: 'percentage',
        scope: 'product',
        promotional_price: 20000,
        badge_label: 'Desde 3 und',
        priority: 1,
        is_quantity_tiered: true,
      },
    } as unknown as EcommerceProduct);
    expect(tieredMapped).toEqual(
      jasmine.objectContaining({
        final_price: 20000,
        regular_final_price: 20000,
        is_on_sale: false,
      }),
    );
  });

  it('en modo auto con allowCatalogFallback carga hasta 8 productos recientes del catálogo', async () => {
    catalogSpy.getProducts.and.returnValue(
      of({
        success: true,
        data: [{ id: 9, slug: 'reciente', name: 'Reciente', final_price: 12000, image_url: null } as unknown as EcommerceProduct],
        meta: { total: 1, page: 1, limit: 8, total_pages: 1 },
      }),
    );

    fixture = TestBed.createComponent(AppPageProductsViewComponent);
    fixture.componentRef.setInput('selection', 'auto');
    fixture.componentRef.setInput('allowCatalogFallback', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(catalogSpy.getProducts).toHaveBeenCalledWith({ limit: 8, include_variants: false });
    expect(el().querySelectorAll('[data-testid="product-block-card"]').length).toBe(1);
  });
});
