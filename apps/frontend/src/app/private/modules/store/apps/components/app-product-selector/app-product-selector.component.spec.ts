import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import { Product, ProductState } from '../../../products/interfaces/product.interface';
import { ProductsService } from '../../../products/services/products.service';
import { AppProductSelectorComponent } from './app-product-selector.component';

const makeProduct = (id: number, name: string, over: Partial<Product> = {}): Product =>
  ({
    id,
    store_id: 1,
    name,
    slug: `prod-${id}`,
    base_price: id * 10000,
    final_price: id * 10000,
    sku: `SKU-${id}`,
    state: ProductState.ACTIVE,
    available_for_ecommerce: true,
    image_url: `https://cdn.vendix.test/${id}.jpg`,
    created_at: new Date(),
    updated_at: new Date(),
    variants: [],
    ...over,
  }) as Product;

describe('AppProductSelectorComponent', () => {
  let fixture: ComponentFixture<AppProductSelectorComponent>;
  let productsSpy: jasmine.SpyObj<ProductsService>;
  let emittedIds: number[][];

  const sampleProducts = [
    makeProduct(10, 'Crema facial', { sku: 'CRM-10', final_price: 45000 }),
    makeProduct(20, 'Sérum vitamina C', { sku: 'SRM-20', final_price: 68000, state: ProductState.INACTIVE }),
    makeProduct(30, 'Protector solar', { sku: 'PRT-30', final_price: 52000 }),
  ];

  beforeEach(() => {
    productsSpy = jasmine.createSpyObj<ProductsService>('ProductsService', ['getProducts', 'getProductById']);
    productsSpy.getProducts.and.returnValue(of({ data: sampleProducts, meta: { total: 3, page: 1, limit: 25, total_pages: 1 } } as any));
    productsSpy.getProductById.and.callFake((id: number) => {
      const found = sampleProducts.find((p) => p.id === id);
      return of(found ?? makeProduct(id, `Producto ${id}`));
    });

    TestBed.configureTestingModule({
      imports: [AppProductSelectorComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: ProductsService, useValue: productsSpy },
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

    emittedIds = [];
    fixture = TestBed.createComponent(AppProductSelectorComponent);
    fixture.componentInstance.selectedIdsChange.subscribe((ids) => emittedIds.push(ids));
    fixture.detectChanges();
  });

  const el = () => fixture.nativeElement as HTMLElement;

  it('permite buscar por nombre/SKU, muestra miniatura, precio y estado, y respeta el orden de selección', async () => {
    const openBtn = el().querySelector('[data-testid="product-selector-open"]') as HTMLButtonElement;
    expect(openBtn.getAttribute('aria-haspopup')).toBe('dialog');
    openBtn.click();
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 10));
    fixture.detectChanges();

    // Foco inicial en el campo de búsqueda y atributos ARIA del diálogo y listbox
    const dialog = el().querySelector('[role="dialog"]');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    const searchInput = el().querySelector('[data-testid="product-selector-search"]') as HTMLInputElement;
    expect(document.activeElement).toBe(searchInput);

    const listbox = el().querySelector('[role="listbox"]');
    expect(listbox?.getAttribute('aria-multiselectable')).toBe('true');

    // Muestra miniatura, SKU, precio y estado
    const option20 = el().querySelector('[data-testid="product-selector-option-20"]') as HTMLButtonElement;
    expect(option20.querySelector('img')?.getAttribute('src')).toBe('https://cdn.vendix.test/20.jpg');
    expect(option20.textContent).toContain('SKU: SRM-20');
    expect(option20.textContent).toContain('$68000');
    expect(option20.textContent).toContain('Inactivo');

    // Elegir en orden inverso: primero 30, luego 10
    (el().querySelector('[data-testid="product-selector-option-30"]') as HTMLButtonElement).click();
    (el().querySelector('[data-testid="product-selector-option-10"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    (el().querySelector('[data-testid="product-selector-apply"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(emittedIds).toEqual([[30, 10]]);
    expect(fixture.componentInstance.modalOpen()).toBeFalse();
    expect(document.activeElement).toBe(openBtn);
  });

  it('respeta el límite máximo y deshabilita opciones restantes al alcanzarlo', async () => {
    fixture.componentRef.setInput('max', 2);
    fixture.detectChanges();

    (el().querySelector('[data-testid="product-selector-open"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    (el().querySelector('[data-testid="product-selector-option-10"]') as HTMLButtonElement).click();
    (el().querySelector('[data-testid="product-selector-option-20"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    const option30 = el().querySelector('[data-testid="product-selector-option-30"]') as HTMLButtonElement;
    expect(option30.disabled).toBeTrue();
    expect(el().querySelector('[data-testid="product-selector-limit-notice"]')?.textContent).toContain('2');
  });

  it('cierra el modal con Escape sin aplicar cambios y devuelve el foco al disparador', async () => {
    const openBtn = el().querySelector('[data-testid="product-selector-open"]') as HTMLButtonElement;
    openBtn.focus();
    openBtn.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    (el().querySelector('[data-testid="product-selector-option-10"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.modalOpen()).toBeFalse();
    expect(emittedIds).toEqual([]);
    expect(document.activeElement).toBe(openBtn);
  });

  it('renderiza chips removibles con aria-label y permite reordenarlos', async () => {
    fixture.componentRef.setInput('selectedIds', [20, 10]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const removeBtn = el().querySelector('[data-testid="product-selector-remove-20"]') as HTMLButtonElement;
    expect(removeBtn.getAttribute('aria-label')).toBe('Quitar Sérum vitamina C');

    // Subir el segundo chip (10 -> primero)
    (el().querySelector('[data-testid="product-selector-up-10"]') as HTMLButtonElement).click();
    expect(emittedIds[emittedIds.length - 1]).toEqual([10, 20]);

    // Quitar el chip 20
    removeBtn.click();
    expect(emittedIds[emittedIds.length - 1]).toEqual([10]);
  });
});
