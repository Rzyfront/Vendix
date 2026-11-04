import { Component, output, provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { EcommerceComponent } from '../../../ecommerce/ecommerce.component';
import { BookingSettingsPanelComponent } from '../../components/booking-settings-panel.component';
import { ProductPageSettingsPanelComponent } from '../../components/product-page-settings-panel.component';
import { ServicePageSettingsPanelComponent } from '../../components/service-page-settings-panel.component';
import { StoreHomeSettingsPanelComponent } from '../../components/store-home-settings-panel.component';
import { LandingBuilderPageComponent } from '../../landing-builder/landing-builder-page.component';
import { ProductPageBuilderPageComponent } from '../../page-builder/product-page/product-page-builder-page.component';
import { StoreHomeBuilderPageComponent } from '../../page-builder/store-home/store-home-builder-page.component';
import type { StoreAppDetail } from '../../interfaces/store-app.interface';
import { StoreAppsService } from '../../services/store-apps.service';
import { AppDetailComponent } from './app-detail.component';

/** Stands in for any settings panel: the contract the header drives. */
abstract class StubPanel {
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly canPublish = signal(true);
  readonly canUnpublish = signal(false);
  readonly changed = output<void>();
  readonly publish = jasmine.createSpy('publish');
  readonly unpublish = jasmine.createSpy('unpublish');
  readonly load = jasmine.createSpy('load');
}

@Component({ selector: 'app-service-page-settings-panel', standalone: true, template: '<p>panel servicios</p>' })
class StubServicePagePanel extends StubPanel {}

@Component({ selector: 'app-booking-settings-panel', standalone: true, template: '<p>panel reservas</p>' })
class StubBookingPanel extends StubPanel {}

@Component({ selector: 'app-landing-builder-page', standalone: true, template: '<p data-testid="landing-builder">builder</p>' })
class StubLandingBuilder {}

@Component({ selector: 'app-store-home-builder-page', standalone: true, template: '<p data-testid="store-home-builder">builder</p>' })
class StubStoreHomeBuilder {}

@Component({ selector: 'app-product-page-builder-page', standalone: true, template: '<p data-testid="product-page-builder">builder</p>' })
class StubProductPageBuilder {}

@Component({ selector: 'app-ecommerce', standalone: true, template: '<p data-testid="ecommerce-admin">gestión</p>' })
class StubEcommerce {}

const detail = (over: Partial<StoreAppDetail> = {}): StoreAppDetail => ({
  key: 'service_page',
  name: 'Service page',
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
  const panel = () => component.panel() as unknown as StubPanel;

  beforeEach(() => {
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
          StoreHomeSettingsPanelComponent,
          ProductPageSettingsPanelComponent,
          ServicePageSettingsPanelComponent,
          BookingSettingsPanelComponent,
          EcommerceComponent,
        ],
      },
      add: { imports: [StubLandingBuilder, StubStoreHomeBuilder, StubProductPageBuilder, StubServicePagePanel, StubBookingPanel, StubEcommerce] },
    });
  });

  it('abre la vista de la app y trae su detalle al entrar, sin modal', async () => {
    await render('service-page', detail());

    expect(apps.get).toHaveBeenCalledOnceWith('service_page');
    expect(component.title()).toBe('Service page');
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('panel servicios');
    expect(el.querySelector('app-modal')).toBeNull();
  });

  it('borrador: ofrece Apagar y Publicar; Publicar lo hace el panel', async () => {
    await render('service-page', detail({ status: 'draft' }));

    expect(actionIds()).toEqual(['deactivate', 'publish']);
    component.onAction('publish');
    expect(panel().publish).toHaveBeenCalled();
  });

  it('publicada: ofrece Despublicar y no Publicar', async () => {
    await render('service-page', detail({ status: 'published' }));
    panel().canUnpublish.set(true);

    expect(actionIds()).toEqual(['unpublish']);
    component.onAction('unpublish');
    expect(panel().unpublish).toHaveBeenCalled();
  });

  it('no instalada: Encender la deja en borrador y recarga el panel', async () => {
    await render('service-page', detail({ status: 'not_installed', enabled: false }));
    expect(actionIds()).toEqual(['activate', 'publish']);

    apps.activate.and.returnValue(of({ success: true, data: detail({ status: 'draft' }) }));
    component.onAction('activate');

    expect(apps.activate).toHaveBeenCalledWith('service_page');
    expect(component.badge()?.label).toBe('Borrador');
    expect(panel().load).toHaveBeenCalled();
  });

  it('Apagar llama a deactivate', async () => {
    await render('service-page', detail({ status: 'draft' }));
    apps.deactivate.and.returnValue(of({ success: true, data: detail({ status: 'disabled', enabled: false }) }));

    component.onAction('deactivate');

    expect(apps.deactivate).toHaveBeenCalledWith('service_page');
    expect(actionIds()).toEqual(['activate', 'publish']);
  });

  it('Publicar queda deshabilitado mientras el panel no puede publicar', async () => {
    await render('service-page', detail({ status: 'draft' }));
    panel().canPublish.set(false);

    expect(component.actions().find((a) => a.id === 'publish')?.disabled).toBeTrue();
  });

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

  it('apps con página propia: su pestaña de ajustes y luego Contenido, Operación, Marca y SEO, Estilo, Vista previa y Estado (apps-f2 S6, apps-f3 S1)', async () => {
    await render('service-page', detail());

    expect(component.tabs().map((t) => t.id)).toEqual(['settings', 'content', 'operation', 'brand', 'style', 'preview', 'general']);
    expect(component.tabs().map((t) => t.label)).toEqual([
      'Servicios y dominio', 'Contenido', 'Operación', 'Marca y SEO', 'Estilo', 'Vista previa', 'Estado',
    ]);
    component.setTab('operation');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-section="operation"]')).not.toBeNull();
    component.setTab('style');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-section="style"]')).not.toBeNull();
    component.setTab('general');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-tab="editor"]').classList).toContain('hidden');
  });

  it('cada app con página propia usa el mismo editor con sus propias secciones', async () => {
    await render('booking', detail({ key: 'booking', name: 'Booking' }));

    component.setTab('content');
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Servicios del alojamiento');
    expect(text).not.toContain('Beneficios');
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
    await render('service-page', detail({ applies_to_store_industries: false }));

    expect(component.actions()).toEqual([]);
    expect(fixture.nativeElement.querySelector('[data-testid="app-not-applicable"]')).not.toBeNull();
  });
});
