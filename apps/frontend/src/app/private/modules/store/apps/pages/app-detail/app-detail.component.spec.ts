import { Component, output, provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { CrmMainPageComponent } from '../../../crm/pages/crm-main-page/crm-main-page.component';
import { BookingSettingsPanelComponent } from '../../components/booking-settings-panel.component';
import { LandingSettingsPanelComponent } from '../../components/landing-settings-panel.component';
import { ProductPageSettingsPanelComponent } from '../../components/product-page-settings-panel.component';
import { ServicePageSettingsPanelComponent } from '../../components/service-page-settings-panel.component';
import { StoreHomeSettingsPanelComponent } from '../../components/store-home-settings-panel.component';
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

@Component({ selector: 'app-product-page-settings-panel', standalone: true, template: '<p>panel producto</p>' })
class StubProductPagePanel extends StubPanel {}

@Component({ selector: 'app-landing-settings-panel', standalone: true, template: '<p>panel landing</p>' })
class StubLandingPanel extends StubPanel {}

@Component({ selector: 'app-crm-main-page', standalone: true, template: '<p data-testid="crm-editor">editor</p>' })
class StubCrmMainPage {}

const detail = (over: Partial<StoreAppDetail> = {}): StoreAppDetail => ({
  key: 'product_page',
  name: 'Product page',
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
          CrmMainPageComponent,
          StoreHomeSettingsPanelComponent,
          LandingSettingsPanelComponent,
          ProductPageSettingsPanelComponent,
          ServicePageSettingsPanelComponent,
          BookingSettingsPanelComponent,
        ],
      },
      add: { imports: [StubCrmMainPage, StubProductPagePanel, StubLandingPanel] },
    });
  });

  it('abre la vista de la app y trae su detalle al entrar, sin modal', async () => {
    await render('product-page', detail());

    expect(apps.get).toHaveBeenCalledOnceWith('product_page');
    expect(component.title()).toBe('Product page');
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('panel producto');
    expect(el.querySelector('app-modal')).toBeNull();
  });

  it('borrador: ofrece Apagar y Publicar; Publicar lo hace el panel', async () => {
    await render('product-page', detail({ status: 'draft' }));

    expect(actionIds()).toEqual(['deactivate', 'publish']);
    component.onAction('publish');
    expect(panel().publish).toHaveBeenCalled();
  });

  it('publicada: ofrece Despublicar y no Publicar', async () => {
    await render('product-page', detail({ status: 'published' }));
    panel().canUnpublish.set(true);

    expect(actionIds()).toEqual(['unpublish']);
    component.onAction('unpublish');
    expect(panel().unpublish).toHaveBeenCalled();
  });

  it('no instalada: Encender la deja en borrador y recarga el panel', async () => {
    await render('product-page', detail({ status: 'not_installed', enabled: false }));
    expect(actionIds()).toEqual(['activate', 'publish']);

    apps.activate.and.returnValue(of({ success: true, data: detail({ status: 'draft' }) }));
    component.onAction('activate');

    expect(apps.activate).toHaveBeenCalledWith('product_page');
    expect(component.badge()?.label).toBe('Borrador');
    expect(panel().load).toHaveBeenCalled();
  });

  it('Apagar llama a deactivate', async () => {
    await render('product-page', detail({ status: 'draft' }));
    apps.deactivate.and.returnValue(of({ success: true, data: detail({ status: 'disabled', enabled: false }) }));

    component.onAction('deactivate');

    expect(apps.deactivate).toHaveBeenCalledWith('product_page');
    expect(actionIds()).toEqual(['activate', 'publish']);
  });

  it('Publicar queda deshabilitado mientras el panel no puede publicar', async () => {
    await render('product-page', detail({ status: 'draft' }));
    panel().canPublish.set(false);

    expect(component.actions().find((a) => a.id === 'publish')?.disabled).toBeTrue();
  });

  it('landing: abre en Contenido con el editor de Clientes reutilizado', async () => {
    await render('landing', detail({ key: 'landing', name: 'Landing page', status: 'published' }));

    expect(apps.get).toHaveBeenCalledOnceWith('landing');
    expect(component.tab()).toBe('content');
    expect(component.tabs().map((t) => t.id)).toEqual(['content', 'settings', 'general']);
    expect(fixture.nativeElement.querySelector('[data-testid="crm-editor"]')).not.toBeNull();
    // Publicada en el dominio de la tienda: se puede llevar a su dominio propio.
    expect(actionIds()).toEqual(['publish']);
    expect(component.actions()[0].label).toBe('Publicar en su dominio');
  });

  it('una app que no aplica a la industria no ofrece acciones', async () => {
    await render('product-page', detail({ applies_to_store_industries: false }));

    expect(component.actions()).toEqual([]);
    expect(fixture.nativeElement.querySelector('[data-testid="app-not-applicable"]')).not.toBeNull();
  });
});
