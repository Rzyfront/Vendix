import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { BookingSettingsModalComponent } from './booking-settings-modal.component';
import { StoreAppsService } from '../services/store-apps.service';
import { ProductsService } from '../../products/services/products.service';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import type { Product } from '../../products/interfaces/product.interface';
import type { StoreAppDetail } from '../interfaces/store-app.interface';

const item = (id: number, name: string, type: 'service' | 'physical' = 'physical') =>
  ({ id, name, slug: `p-${id}`, product_type: type, available_for_ecommerce: true }) as unknown as Product;

const detail = (over: Partial<StoreAppDetail> = {}): StoreAppDetail => ({
  key: 'booking',
  name: 'Booking',
  description: '',
  applies_to_store_industries: true,
  status: 'not_installed',
  domain: null,
  public_url: null,
  published_at: null,
  config: {},
  ...over,
});

describe('BookingSettingsModalComponent (apps-module Fase 4)', () => {
  let fixture: ComponentFixture<BookingSettingsModalComponent>;
  let component: BookingSettingsModalComponent;
  let apps: jasmine.SpyObj<StoreAppsService>;
  let products: jasmine.SpyObj<ProductsService>;

  const open = async (d: StoreAppDetail) => {
    apps.get.and.returnValue(of({ success: true, data: d }));
    fixture = TestBed.createComponent(BookingSettingsModalComponent);
    component = fixture.componentInstance;
    component.isOpen.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
  };

  beforeEach(() => {
    apps = jasmine.createSpyObj('StoreAppsService', [
      'get',
      'saveBookingConfig',
      'publishBooking',
      'unpublishBooking',
      'bookingCustomDomains',
    ]);
    apps.bookingCustomDomains.and.returnValue(
      of({ data: [{ id: 77, hostname: 'reservas.mihotel.com', status: 'active', app_type: 'STORE_LANDING' }] }),
    );
    apps.saveBookingConfig.and.returnValue(of({}));
    apps.publishBooking.and.returnValue(of({}));
    apps.unpublishBooking.and.returnValue(of({}));
    products = jasmine.createSpyObj('ProductsService', ['getProducts', 'getProductById']);
    products.getProductById.and.callFake((id: number) => of(item(id, `Item ${id}`)));

    TestBed.configureTestingModule({
      imports: [BookingSettingsModalComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: StoreAppsService, useValue: apps },
        { provide: ProductsService, useValue: products },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success', 'error']) },
      ],
    });
  });

  it('al abrir carga las amenidades elegidas y los dominios propios', async () => {
    await open(detail({ status: 'draft', config: { product_ids: [9, 4] } }));

    expect(component.products().map((p) => p.id)).toEqual([9, 4]);
    expect(component.customDomains().map((d) => d.hostname)).toEqual(['reservas.mihotel.com']);
    expect(component.statusLabel()).toBe('Borrador');
  });

  it('publicar guarda las amenidades y publica en la dirección de Vendix', async () => {
    await open(detail());
    component.pick(item(9, 'Desayuno'));
    component.pick(item(9, 'Desayuno')); // no se repite

    component.save(true);

    expect(apps.saveBookingConfig).toHaveBeenCalledWith({ product_ids: [9] });
    expect(apps.publishBooking).toHaveBeenCalledWith(null);
  });

  it('publicar en un dominio propio lo envía', async () => {
    await open(detail());
    component.customDomainId.set(77);

    component.save(true);

    expect(apps.publishBooking).toHaveBeenCalledWith(77);
  });

  it('respeta el tope de 8 productos', async () => {
    await open(detail());
    for (let id = 1; id <= 11; id++) component.pick(item(id, `P${id}`));

    expect(component.products().length).toBe(8);
  });

  it('el buscador deja fuera los servicios', async () => {
    products.getProducts.and.returnValue(
      of({ data: [item(5, 'Masaje', 'service'), item(9, 'Desayuno')], pagination: {} } as any),
    );
    await open(detail());

    component.query.set('des');
    fixture.detectChanges();
    // Zoneless: wait the real 300 ms debounce.
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(component.results().map((p) => p.id)).toEqual([9]);
  });

  it('muestra el error del servidor cuando la tienda no es hotel', async () => {
    apps.publishBooking.and.returnValue(
      throwError(() => ({
        status: 403,
        error: {
          success: false,
          error_code: 'STORE_APPS_008',
          message: 'La página de reservas solo está disponible para tiendas de hotelería.',
        },
      })),
    );
    await open(detail());

    component.save(true);

    expect(component.busy()).toBeFalse();
    expect(component.error()).toBeTruthy();
  });

  it('publicada en un dominio propio lo deja seleccionado y despublicar llama al endpoint', async () => {
    await open(
      detail({
        status: 'published',
        domain: { id: 77, hostname: 'reservas.mihotel.com', status: 'active' },
        public_url: 'https://reservas.mihotel.com',
      }),
    );
    expect(component.isPublished()).toBeTrue();
    expect(component.customDomainId()).toBe(77);

    component.unpublish();
    expect(apps.unpublishBooking).toHaveBeenCalled();
  });
});
