import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ServicePageSettingsModalComponent } from './service-page-settings-modal.component';
import { StoreAppsService } from '../services/store-apps.service';
import { ProductsService } from '../../products/services/products.service';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import type { Product } from '../../products/interfaces/product.interface';
import type { StoreAppDetail } from '../interfaces/store-app.interface';

const item = (id: number, name: string, type: 'service' | 'physical' = 'service') =>
  ({ id, name, slug: `p-${id}`, product_type: type, available_for_ecommerce: true }) as unknown as Product;

const detail = (over: Partial<StoreAppDetail> = {}): StoreAppDetail => ({
  key: 'service_page',
  name: 'Service page',
  description: '',
  applies_to_store_industries: true,
  status: 'not_installed',
  domain: null,
  public_url: null,
  published_at: null,
  config: {},
  ...over,
});

describe('ServicePageSettingsModalComponent (apps-module Fase 3)', () => {
  let fixture: ComponentFixture<ServicePageSettingsModalComponent>;
  let component: ServicePageSettingsModalComponent;
  let apps: jasmine.SpyObj<StoreAppsService>;
  let products: jasmine.SpyObj<ProductsService>;

  const open = async (d: StoreAppDetail) => {
    apps.get.and.returnValue(of({ success: true, data: d }));
    fixture = TestBed.createComponent(ServicePageSettingsModalComponent);
    component = fixture.componentInstance;
    component.isOpen.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
  };

  beforeEach(() => {
    apps = jasmine.createSpyObj('StoreAppsService', [
      'get',
      'saveServicePageConfig',
      'publishServicePage',
      'unpublishServicePage',
      'servicePageCustomDomains',
    ]);
    apps.servicePageCustomDomains.and.returnValue(
      of({ data: [{ id: 77, hostname: 'citas.mitienda.com', status: 'active', app_type: 'STORE_LANDING' }] }),
    );
    apps.saveServicePageConfig.and.returnValue(of({}));
    apps.publishServicePage.and.returnValue(of({}));
    apps.unpublishServicePage.and.returnValue(of({}));
    products = jasmine.createSpyObj('ProductsService', ['getProducts', 'getProductById']);
    products.getProductById.and.callFake((id: number) => of(item(id, `Item ${id}`)));

    TestBed.configureTestingModule({
      imports: [ServicePageSettingsModalComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: StoreAppsService, useValue: apps },
        { provide: ProductsService, useValue: products },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success', 'error']) },
      ],
    });
  });

  it('al abrir carga los servicios destacados, los productos y los dominios propios', async () => {
    await open(detail({ status: 'draft', config: { featured_service_ids: [5, 6], product_ids: [9] } }));

    expect(component.services().map((s) => s.id)).toEqual([5, 6]);
    expect(component.products().map((p) => p.id)).toEqual([9]);
    expect(component.customDomains().map((d) => d.hostname)).toEqual(['citas.mitienda.com']);
    expect(component.statusLabel()).toBe('Borrador');
  });

  it('publicar sin destacados guarda la configuración y publica en la dirección de Vendix', async () => {
    await open(detail());

    component.save(true);

    expect(apps.saveServicePageConfig).toHaveBeenCalledWith({ featured_service_ids: [], product_ids: [] });
    expect(apps.publishServicePage).toHaveBeenCalledWith(null);
  });

  it('publicar con servicios y productos elegidos usa el dominio propio', async () => {
    await open(detail());
    component.search('service', 'masaje');
    component.pick(item(5, 'Masaje'));
    component.search('service', 'masaje');
    component.pick(item(5, 'Masaje')); // no se repite
    component.search('product', 'aceite');
    component.pick(item(9, 'Aceite', 'physical'));
    component.customDomainId.set(77);

    component.save(true);

    expect(apps.saveServicePageConfig).toHaveBeenCalledWith({ featured_service_ids: [5], product_ids: [9] });
    expect(apps.publishServicePage).toHaveBeenCalledWith(77);
  });

  it('respeta los topes de 12 servicios y 8 productos', async () => {
    await open(detail());
    component.search('service', 'x');
    for (let id = 1; id <= 15; id++) component.pick(item(id, `S${id}`));
    component.search('product', 'x');
    for (let id = 100; id <= 110; id++) component.pick(item(id, `P${id}`, 'physical'));

    expect(component.services().length).toBe(12);
    expect(component.products().length).toBe(8);
  });

  it('el buscador de servicios pide solo servicios', async () => {
    products.getProducts.and.returnValue(
      of({ data: [item(5, 'Masaje'), item(9, 'Aceite', 'physical')], pagination: {} } as any),
    );
    await open(detail());

    component.search('service', 'mas');
    fixture.detectChanges();
    // Zoneless: wait the real 300 ms debounce.
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(products.getProducts).toHaveBeenCalledWith(
      jasmine.objectContaining({ search: 'mas', product_type: 'service' }),
    );
    expect(component.results().map((p) => p.id)).toEqual([5]);
  });

  it('publicada en un dominio propio lo deja seleccionado y despublicar llama al endpoint', async () => {
    await open(
      detail({
        status: 'published',
        domain: { id: 77, hostname: 'citas.mitienda.com', status: 'active' },
        public_url: 'https://citas.mitienda.com',
      }),
    );
    expect(component.isPublished()).toBeTrue();
    expect(component.customDomainId()).toBe(77);

    component.unpublish();
    expect(apps.unpublishServicePage).toHaveBeenCalled();
  });
});
