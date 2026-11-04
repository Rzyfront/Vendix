import { Component, input, model, output, provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { BuilderPreviewPaneComponent } from '../../builder/builder-preview-pane.component';
import type { BuilderDevice } from '../../builder/builder.types';
import type { StoreAppDetail } from '../../interfaces/store-app.interface';
import { StoreAppsService } from '../../services/store-apps.service';
import { APP_PAGE_TEMPLATES, AppPageDocument } from '../../templates';
import { AppPageBuilderPageComponent } from '../app-page-builder-page.component';
import { blocksToPage, pageToBlocks } from '../page-builder-document';
import { STORE_HOME_BUILDER_CATALOG, StoreHomeContext, StoreHomeSettings, storeHomePreview } from './store-home-builder';
import { StoreHomeBuilderPageComponent } from './store-home-builder-page.component';

/** The real pane loads the frame route in an iframe; the spec only checks what it receives. */
@Component({ selector: 'app-builder-preview-pane', standalone: true, template: '<div data-testid="preview-pane"></div>' })
class StubPreviewPane {
  readonly frameSrc = input<string>('');
  readonly payload = input<unknown>(null);
  readonly selectedBlockId = input<string | null>(null);
  readonly device = model<BuilderDevice>('mobile');
  readonly blockSelect = output<string>();
}

const CONTEXT: StoreHomeContext = {
  store_name: 'Mi Tienda',
  branding: { name: 'Mi Tienda', logo_url: null, primary_color: '#1E40AF', secondary_color: null, accent_color: null },
  footer: { text: 'Hecho con Vendix', site_url: 'https://vendix.com' },
  apps: [
    { kind: 'ecommerce', name: 'Tienda en línea', url: 'https://mitienda.vendix.online' },
    { kind: 'booking', name: 'Reservas', url: 'https://mitienda-booking.vendix.online' },
  ],
};

function appDetail(over: Partial<StoreAppDetail> = {}): StoreAppDetail {
  return {
    key: 'store_home',
    name: 'Inicio de tienda',
    description: '',
    applies_to_store_industries: true,
    status: 'draft',
    enabled: true,
    domain: null,
    public_url: 'https://mitienda-store.vendix.online',
    published_at: null,
    config: { footer_text: null },
    ...over,
  } as StoreAppDetail;
}

describe('StoreHomeBuilderPageComponent (F6-B)', () => {
  let fixture: ComponentFixture<StoreHomeBuilderPageComponent>;
  let apps: jasmine.SpyObj<StoreAppsService>;
  let calls: string[];

  async function render(detail = appDetail()): Promise<void> {
    calls = [];
    apps = jasmine.createSpyObj('StoreAppsService', [
      'get',
      'activate',
      'deactivate',
      'savePage',
      'saveStoreHomeConfig',
      'storeHomePreviewContext',
      'publishStoreHome',
      'unpublishStoreHome',
    ]);
    apps.get.and.returnValue(of({ success: true, data: detail }));
    apps.storeHomePreviewContext.and.returnValue(of({ data: { ...CONTEXT } }));
    apps.savePage.and.callFake((kind, page) => {
      calls.push(`savePage:${kind}`);
      return of({ success: true, data: { page } });
    });
    apps.saveStoreHomeConfig.and.callFake(() => {
      calls.push('saveStoreHomeConfig');
      return of({});
    });
    apps.publishStoreHome.and.callFake(() => {
      calls.push('publishStoreHome');
      return of({});
    });
    apps.unpublishStoreHome.and.returnValue(of({}));
    TestBed.configureTestingModule({
      imports: [StoreHomeBuilderPageComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: StoreAppsService, useValue: apps },
        { provide: AuthFacade, useValue: { userStoreName: signal('Mi Tienda'), userStore: signal({ logo_url: null }) } },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success', 'error', 'info']) },
      ],
    });
    TestBed.overrideComponent(AppPageBuilderPageComponent, {
      remove: { imports: [BuilderPreviewPaneComponent] },
      add: { imports: [StubPreviewPane] },
    });
    fixture = TestBed.createComponent(StoreHomeBuilderPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const builder = () =>
    fixture.debugElement.children[0].componentInstance as AppPageBuilderPageComponent<StoreHomeSettings, StoreHomeContext>;
  const actionIds = () => builder().actions().map((a) => a.id);
  const refresh = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  afterEach(() => TestBed.resetTestingModule());

  it('una sola barra con las cinco pestañas; sin página propia la página queda igual que hoy y no hay nada que guardar', async () => {
    await render();

    expect(el().querySelectorAll('app-sticky-header').length).toBe(1);
    expect(builder().tabs.map((t) => t.label)).toEqual(['General', 'Contenido', 'Estilo', 'SEO', 'Vista previa']);
    // Sin config.page: solo la portada (virtual) y un documento vacío, como antes de F6-B.
    expect(builder().blocks().map((b) => b.id)).toEqual(['hero']);
    expect(builder().page()).toEqual({ schema_version: 1, blocks: [] });
    expect(builder().dirty()).toBeFalse();
    expect(actionIds()).toEqual(['publish']);
    expect(builder().subtitle()).toBe('https://mitienda-store.vendix.online');
  });

  it('editar la portada pide Guardar; Guardar envía solo la página y queda al día', async () => {
    await render();

    builder().setProp({ blockId: 'hero', key: 'title', value: 'Bienvenidos' });
    await refresh();
    expect(actionIds()).toEqual(['save', 'publish']);
    expect(builder().subtitle()).toContain('Cambios sin guardar');

    builder().save();
    await refresh();
    expect(calls).toEqual(['savePage:store_home']);
    expect(apps.savePage.calls.mostRecent().args[1]).toEqual({ schema_version: 1, blocks: [], hero: { title: 'Bienvenidos' } });
    expect(builder().dirty()).toBeFalse();
  });

  it('Ctrl/Cmd+S guarda cuando hay cambios', async () => {
    await render();
    builder().settings.set({ footer_text: 'Hecho en Bogotá' });
    await refresh();

    builder().onKeydown(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }));
    await refresh();
    expect(calls).toEqual(['saveStoreHomeConfig']);
    expect(apps.saveStoreHomeConfig).toHaveBeenCalledWith({ footer_text: 'Hecho en Bogotá' });
  });

  it('publicada: los cambios se publican en vivo («Publicar cambios»), sin volver a publicar la app', async () => {
    await render(appDetail({ status: 'published' }));
    expect(actionIds()).toEqual(['unpublish']);

    builder().addBlock('highlights');
    await refresh();
    const publish = builder().actions().find((a) => a.id === 'publish');
    expect(actionIds()).toEqual(['unpublish', 'publish']);
    expect(publish?.label).toBe('Publicar cambios');
    expect(builder().subtitle()).toContain('Cambios sin publicar');

    builder().onAction('publish');
    await refresh();
    expect(calls).toEqual(['savePage:store_home']);
  });

  it('borrador: Publicar guarda lo pendiente y luego publica el inicio', async () => {
    await render();
    builder().setProp({ blockId: 'hero', key: 'title', value: 'Hola' });

    builder().onAction('publish');
    await refresh();
    expect(calls).toEqual(['savePage:store_home', 'publishStoreHome']);
  });

  it('apagada: Publicar queda deshabilitado con el motivo y abre en General', async () => {
    await render(appDetail({ status: 'disabled' }));

    expect(builder().tab()).toBe('general');
    const publish = builder().actions().find((a) => a.id === 'publish');
    expect(publish?.disabled).toBeTrue();
    expect(publish?.title).toBe('Enciende la app en General para publicarla.');
  });

  it('Mis apps queda anclada bajo la portada aunque se agregue después de otra sección', async () => {
    await render();
    builder().addBlock('contact');
    builder().addBlock('apps');

    expect(builder().blocks().map((b) => b.type)).toEqual(['hero', 'apps', 'contact']);
    builder().move(1, 2);
    expect(builder().blocks().map((b) => b.type)).toEqual(['hero', 'apps', 'contact']);
  });

  it('General: elegir qué apps se muestran y su orden se guarda en el bloque Mis apps', async () => {
    await render();
    builder().setTab('general');
    await refresh();
    (el().querySelector('[data-testid="store-home-add-apps"]') as HTMLButtonElement).click();
    await refresh();
    expect(el().querySelector('[data-testid="store-home-app-booking"]')).not.toBeNull();

    // Ocultar la tienda en línea: solo Reservas.
    (el().querySelector('[data-testid="store-home-app-ecommerce"] input') as HTMLInputElement).click();
    await refresh();
    const apps = builder().page().blocks.find((b) => b.type === 'apps');
    expect(apps?.props['kinds']).toEqual(['booking']);
    expect(storeHomePreview(builder().previewPayload()).apps?.map((a) => a.kind)).toEqual(['booking']);

    // «Mostrar todas» vuelve al comportamiento de siempre (sin lista).
    (el().querySelector('[data-testid="store-home-apps-all"]') as HTMLButtonElement).click();
    await refresh();
    expect('kinds' in (builder().page().blocks.find((b) => b.type === 'apps')?.props ?? {})).toBeFalse();
  });

  it('Estilo: WhatsApp y tokens van a brand y theme; vaciarlos los quita', async () => {
    await render();
    builder().setBrand('whatsapp_number', '+57 300 123 4567');
    builder().setBrand('whatsapp_floating', true);
    builder().setTheme({ primary_color: '#112233' });
    expect(builder().page().brand).toEqual({ whatsapp_number: '+57 300 123 4567', whatsapp_floating: true });
    expect(builder().page().theme).toEqual({ primary_color: '#112233' });

    builder().setBrand('whatsapp_number', undefined);
    builder().setTheme({});
    expect(builder().page().brand).toBeUndefined();
    expect(builder().page().theme).toBeUndefined();
  });

  it('una plantilla reemplaza portada, secciones y estilo y conserva la marca', async () => {
    await render();
    builder().setBrand('whatsapp_number', '+573001234567');
    builder().applyTemplate({ id: 'base', name: 'Base', description: '', page: APP_PAGE_TEMPLATES.store_home.page });

    expect(builder().page().blocks.map((b) => b.type)).toEqual(['apps', 'highlights', 'contact']);
    expect(builder().page().brand?.whatsapp_number).toBe('+573001234567');
  });
});

describe('page builder document (F6-B)', () => {
  it('una página guardada vuelve idéntica tras pasar por el constructor', () => {
    const page: AppPageDocument = {
      ...APP_PAGE_TEMPLATES.store_home.page,
      hero: { title: 'Hola' },
      brand: { whatsapp_number: '+573001234567' },
    };
    const back = blocksToPage('store_home', STORE_HOME_BUILDER_CATALOG, { ...page, blocks: [] }, pageToBlocks(page));
    expect(back).toEqual(page);
  });

  it('vista previa: Mis apps oculta = sin apps; pie vacío = el de siempre', () => {
    const page: AppPageDocument = { schema_version: 1, blocks: [{ id: 'apps', type: 'apps', enabled: false, props: {} }] };
    const home = storeHomePreview({ kind: 'store_home', page, settings: { footer_text: '' }, context: CONTEXT, storeName: 'X', storeLogoUrl: null });
    expect(home.apps).toBeUndefined();
    expect(home.footer.text).toBe('');
    expect(home.store_name).toBe('Mi Tienda');
  });
});
