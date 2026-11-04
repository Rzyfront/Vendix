import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { StoreHomeSettingsPanelComponent } from './store-home-settings-panel.component';
import { StoreAppsService } from '../services/store-apps.service';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import type { StoreAppDetail } from '../interfaces/store-app.interface';

const detail = (over: Partial<StoreAppDetail> = {}): StoreAppDetail => ({
  key: 'store_home',
  name: 'Inicio de tienda',
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

describe('StoreHomeSettingsPanelComponent (apps-module Fase 5)', () => {
  let fixture: ComponentFixture<StoreHomeSettingsPanelComponent>;
  let component: StoreHomeSettingsPanelComponent;
  let apps: jasmine.SpyObj<StoreAppsService>;

  const open = async (d: StoreAppDetail) => {
    apps.get.and.returnValue(of({ success: true, data: d }));
    fixture = TestBed.createComponent(StoreHomeSettingsPanelComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  };

  beforeEach(() => {
    apps = jasmine.createSpyObj('StoreAppsService', [
      'get',
      'saveStoreHomeConfig',
      'publishStoreHome',
      'unpublishStoreHome',
    ]);
    apps.saveStoreHomeConfig.and.returnValue(of({}));
    apps.publishStoreHome.and.returnValue(of({}));
    apps.unpublishStoreHome.and.returnValue(of({}));

    TestBed.configureTestingModule({
      imports: [StoreHomeSettingsPanelComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: StoreAppsService, useValue: apps },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success', 'error']) },
      ],
    });
  });

  it('al abrir muestra el estado y el texto del pie guardado', async () => {
    await open(detail({ status: 'draft', config: { footer_text: 'Hecho con Vendix' } }));

    expect(component.statusLabel()).toBe('Borrador');
    expect(component.footerText()).toBe('Hecho con Vendix');
  });

  it('publicar guarda el pie y luego publica', async () => {
    await open(detail());
    component.footerText.set('  Hecho con Vendix  ');
    const changed = jasmine.createSpy('changed');
    component.changed.subscribe(changed);

    component.save(true);

    expect(apps.saveStoreHomeConfig).toHaveBeenCalledWith({ footer_text: 'Hecho con Vendix' });
    expect(apps.publishStoreHome).toHaveBeenCalled();
    expect(changed).toHaveBeenCalled();
  });

  it('un pie vacío se guarda como null (lema de Vendix) sin publicar', async () => {
    await open(detail({ status: 'draft' }));
    component.footerText.set('   ');

    component.save(false);

    expect(apps.saveStoreHomeConfig).toHaveBeenCalledWith({ footer_text: null });
    expect(apps.publishStoreHome).not.toHaveBeenCalled();
  });

  it('publicado: muestra la URL y despublicar devuelve la landing', async () => {
    await open(
      detail({
        status: 'published',
        public_url: 'https://roku-store.vendix.online',
        domain: { id: 1, hostname: 'roku-store.vendix.online', status: 'active' },
      }),
    );
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('https://roku-store.vendix.online');
    // The view header offers Despublicar, not Publicar, for a published app.
    expect(component.canUnpublish()).toBeTrue();

    component.unpublish();

    expect(apps.unpublishStoreHome).toHaveBeenCalled();
  });

  it('un error del servidor se muestra en el panel', async () => {
    await open(detail());
    apps.publishStoreHome.and.returnValue(
      throwError(() => ({ error: { message: 'La tienda no tiene activo su dominio principal' } })),
    );

    component.save(true);

    expect(component.error()).toBeTruthy();
    expect(component.busy()).toBeFalse();
  });
});
