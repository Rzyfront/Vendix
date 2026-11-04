import { Component, provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { EcommerceComponent } from '../../../ecommerce/ecommerce.component';
import { LandingBuilderPageComponent } from '../../landing-builder/landing-builder-page.component';
import { BookingBuilderPageComponent } from '../../page-builder/booking/booking-builder-page.component';
import { ServicePageBuilderPageComponent } from '../../page-builder/service-page/service-page-builder-page.component';
import { ProductPageBuilderPageComponent } from '../../page-builder/product-page/product-page-builder-page.component';
import { StoreHomeBuilderPageComponent } from '../../page-builder/store-home/store-home-builder-page.component';
import type { StoreAppDetail } from '../../interfaces/store-app.interface';
import { StoreAppsService } from '../../services/store-apps.service';
import { AppDetailComponent } from './app-detail.component';

@Component({ selector: 'app-landing-builder-page', standalone: true, template: '<p data-testid="landing-builder">builder</p>' })
class StubLandingBuilder {}

@Component({ selector: 'app-store-home-builder-page', standalone: true, template: '<p data-testid="store-home-builder">builder</p>' })
class StubStoreHomeBuilder {}

@Component({ selector: 'app-service-page-builder-page', standalone: true, template: '<p data-testid="service-page-builder">builder</p>' })
class StubServicePageBuilder {}

@Component({ selector: 'app-product-page-builder-page', standalone: true, template: '<p data-testid="product-page-builder">builder</p>' })
class StubProductPageBuilder {}

@Component({ selector: 'app-booking-builder-page', standalone: true, template: '<p data-testid="booking-builder">builder</p>' })
class StubBookingBuilder {}

@Component({ selector: 'app-ecommerce', standalone: true, template: '<p data-testid="ecommerce-admin">gestión</p>' })
class StubEcommerce {}

const detail = (over: Partial<StoreAppDetail> = {}): StoreAppDetail => ({
  key: 'booking',
  name: 'Booking',
  description: '',
  applies_to_store_industries: true,
  status: 'draft',
  enabled: true,
  domain: null,
  public_url: null,
  published_at: null,
  config: {},
  ...over,
});

describe('AppDetailComponent (apps-vistas-f1 S3/S4/S6)', () => {
  let fixture: ComponentFixture<AppDetailComponent>;
  let component: AppDetailComponent;
  let apps: jasmine.SpyObj<StoreAppsService>;

  const render = async (slug: string, d: StoreAppDetail) => {
    apps.get.and.returnValue(of({ success: true, data: d }));
    TestBed.overrideProvider(ActivatedRoute, {
      useValue: {
        paramMap: of(convertToParamMap({ kind: slug })),
        snapshot: { paramMap: convertToParamMap({ kind: slug }) },
      },
    });
    fixture = TestBed.createComponent(AppDetailComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const actionIds = () => component.actions().map((a) => a.id);

  const configure = () => {
    apps = jasmine.createSpyObj('StoreAppsService', ['get', 'activate', 'deactivate']);
    TestBed.configureTestingModule({
      imports: [AppDetailComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: StoreAppsService, useValue: apps },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success', 'error', 'info']) },
      ],
    });
    TestBed.overrideComponent(AppDetailComponent, {
      remove: {
        imports: [
          LandingBuilderPageComponent,
          StoreHomeBuilderPageComponent,
          ProductPageBuilderPageComponent,
          ServicePageBuilderPageComponent,
          BookingBuilderPageComponent,
          EcommerceComponent,
        ],
      },
      add: { imports: [StubLandingBuilder, StubStoreHomeBuilder, StubProductPageBuilder, StubServicePageBuilder, StubBookingBuilder, StubEcommerce] },
    });
  };

  beforeEach(configure);

  it('landing (F6-A): monta solo el constructor de la landing, con su propia cabecera y sus datos', async () => {
    await render('landing', detail({ key: 'landing', name: 'Landing page', status: 'published' }));

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="landing-builder"]')).not.toBeNull();
    // Una sola barra: la de esta vista no se dibuja, y el constructor carga lo suyo.
    expect(el.querySelector('app-sticky-header')).toBeNull();
    expect(apps.get).not.toHaveBeenCalled();
  });

  it('inicio de tienda (F6-B): monta solo su constructor, con su propia cabecera y sus datos', async () => {
    await render('store-home', detail({ key: 'store_home', name: 'Inicio de tienda', status: 'published' }));

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="store-home-builder"]')).not.toBeNull();
    expect(el.querySelector('app-sticky-header')).toBeNull();
    expect(apps.get).not.toHaveBeenCalled();
  });

  it('página de producto (F6-B): monta solo su constructor, con su propia cabecera y sus datos', async () => {
    await render('product-page', detail({ key: 'product_page', name: 'Página de producto', status: 'published' }));

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="product-page-builder"]')).not.toBeNull();
    expect(el.querySelector('app-sticky-header')).toBeNull();
    expect(apps.get).not.toHaveBeenCalled();
  });

  it('reservas (F6-B): monta solo su constructor, con su propia cabecera y sus datos', async () => {
    await render('booking', detail({ status: 'published' }));

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="booking-builder"]')).not.toBeNull();
    expect(el.querySelector('app-sticky-header')).toBeNull();
    expect(apps.get).not.toHaveBeenCalled();
  });

  it('página de servicios (F6-B): monta solo su constructor, con su propia cabecera y sus datos', async () => {
    await render('service-page', detail({ key: 'service_page', name: 'Página de servicios', status: 'published' }));

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="service-page-builder"]')).not.toBeNull();
    expect(el.querySelector('app-sticky-header')).toBeNull();
    expect(apps.get).not.toHaveBeenCalled();
  });

  it('las cuatro apps de página (inicio, producto, servicios, reservas) montan su constructor propio, sin la barra clásica ni el editor viejo', async () => {
    const cases = [
      ['store-home', 'store_home', 'store-home-builder'],
      ['product-page', 'product_page', 'product-page-builder'],
      ['service-page', 'service_page', 'service-page-builder'],
      ['booking', 'booking', 'booking-builder'],
    ] as const;
    for (const [slug, key, testid] of cases) {
      TestBed.resetTestingModule();
      configure();
      await render(slug, detail({ key, name: key, status: 'published' }));
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector(`[data-testid="${testid}"]`)).not.toBeNull();
      expect(el.querySelector('app-sticky-header')).toBeNull();
      expect(el.querySelector('app-app-page-editor')).toBeNull();
      expect(apps.get).not.toHaveBeenCalled();
    }
  });

  it('Tienda en línea: cabecera sin acciones de publicar/encender y la gestión de siempre en su pestaña (apps-f2 S1)', async () => {
    await render('ecommerce', detail({ key: 'ecommerce', name: 'Tienda en línea', status: 'published' }));

    expect(apps.get).toHaveBeenCalledOnceWith('ecommerce');
    expect(component.actions()).toEqual([]);
    expect(component.tabs().map((t) => t.id)).toEqual(['ecommerce', 'general']);
    expect(component.tab()).toBe('ecommerce');
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="ecommerce-admin"]')).not.toBeNull();
    expect(el.querySelector('app-sticky-header')).toBeNull();
    expect(el.querySelector('[data-testid="ecommerce-header"]')?.textContent).toContain('Tienda en línea');
    expect(el.querySelector('app-app-page-editor')).toBeNull();
  });

  it('una app que no aplica a la industria no ofrece acciones', async () => {
    await render('ecommerce', detail({ key: 'ecommerce', name: 'Tienda en línea', applies_to_store_industries: false }));

    expect(component.actions()).toEqual([]);
    expect(fixture.nativeElement.querySelector('[data-testid="app-not-applicable"]')).not.toBeNull();
  });
});
