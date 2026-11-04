import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ProductPageSettingsPanelComponent } from './product-page-settings-panel.component';
import { StoreAppsService } from '../services/store-apps.service';
import { ProductsService } from '../../products/services/products.service';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import type { Product } from '../../products/interfaces/product.interface';
import type { StoreAppDetail } from '../interfaces/store-app.interface';

const product = (id: number, name: string, available = true) =>
  ({ id, name, slug: `p-${id}`, available_for_ecommerce: available }) as unknown as Product;

const detail = (over: Partial<StoreAppDetail> = {}): StoreAppDetail => ({
  key: 'product_page',
  name: 'Página de producto',
  description: '',
  applies_to_store_industries: true,
  status: 'not_installed',
  enabled: false,
  domain: null,
  public_url: null,
  published_at: null,
  config: {},
  ...over,
});

describe('ProductPageSettingsPanelComponent (apps-module Fase 2)', () => {
  let fixture: ComponentFixture<ProductPageSettingsPanelComponent>;
  let component: ProductPageSettingsPanelComponent;
  let apps: jasmine.SpyObj<StoreAppsService>;
  let products: jasmine.SpyObj<ProductsService>;

  const open = async (d: StoreAppDetail) => {
    apps.get.and.returnValue(of({ success: true, data: d }));
    fixture = TestBed.createComponent(ProductPageSettingsPanelComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  };

  beforeEach(() => {
    apps = jasmine.createSpyObj('StoreAppsService', [
      'get',
      'saveProductPageConfig',
      'publishProductPage',
      'unpublishProductPage',
      'productPageCustomDomains',
    ]);
    apps.productPageCustomDomains.and.returnValue(
      of({ data: [{ id: 77, hostname: 'mitienda.com', status: 'active', app_type: 'STORE_LANDING' }] }),
    );
    apps.saveProductPageConfig.and.returnValue(of({}));
    apps.publishProductPage.and.returnValue(of({}));
    apps.unpublishProductPage.and.returnValue(of({}));
    products = jasmine.createSpyObj('ProductsService', ['getProducts', 'getProductById']);
    products.getProductById.and.callFake((id: number) => of(product(id, `Producto ${id}`)));

    TestBed.configureTestingModule({
      imports: [ProductPageSettingsPanelComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: StoreAppsService, useValue: apps },
        { provide: ProductsService, useValue: products },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success', 'error']) },
      ],
    });
  });

  it('al abrir carga el destacado, los complementos y los dominios propios', async () => {
    await open(detail({ status: 'draft', config: { product_id: 5, complement_product_ids: [6, 7] } }));

    expect(component.featured()?.name).toBe('Producto 5');
    expect(component.complements().map((c) => c.id)).toEqual([6, 7]);
    expect(component.customDomains().map((d) => d.hostname)).toEqual(['mitienda.com']);
    expect(component.statusLabel()).toBe('Borrador');
  });

  it('publicar guarda la configuración y publica en el dominio propio elegido', async () => {
    await open(detail());
    component.search('featured', 'leche');
    component.pick(product(5, 'Leche'));
    component.search('complement', 'pan');
    component.pick(product(6, 'Pan'));
    component.pick(product(5, 'Leche')); // el destacado no se repite como complemento
    component.customDomainId.set(77);

    component.save(true);

    expect(apps.saveProductPageConfig).toHaveBeenCalledWith({
      product_id: 5,
      complement_product_ids: [6],
    });
    expect(apps.publishProductPage).toHaveBeenCalledWith(77);
  });

  it('no deja pasar de 8 complementos', async () => {
    await open(detail());
    component.search('featured', 'x');
    component.pick(product(1, 'Destacado'));
    component.search('complement', 'x');
    for (let id = 2; id <= 12; id++) component.pick(product(id, `P${id}`));

    expect(component.complements().length).toBe(8);
  });

  it('publicada en la dirección de Vendix bloquea cambiar el destacado', async () => {
    await open(
      detail({
        status: 'published',
        domain: { id: 900, hostname: 'roku-leche.vendix.online', status: 'active' },
        public_url: 'https://roku-leche.vendix.online',
        config: { product_id: 5, complement_product_ids: [] },
      }),
    );

    expect(component.isPublished()).toBeTrue();
    expect(component.lockFeatured()).toBeTrue();
    expect(component.customDomainId()).toBeNull();
  });

  it('publicada en un dominio propio permite cambiar el destacado', async () => {
    await open(
      detail({
        status: 'published',
        domain: { id: 77, hostname: 'mitienda.com', status: 'active' },
        config: { product_id: 5, complement_product_ids: [] },
      }),
    );

    expect(component.lockFeatured()).toBeFalse();
    expect(component.customDomainId()).toBe(77);
  });

  it('despublicar llama al endpoint', async () => {
    await open(detail({ status: 'published', config: { product_id: 5 } }));
    component.unpublish();

    expect(apps.unpublishProductPage).toHaveBeenCalled();
  });
});
