import { Component, input, model, output, provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import type { CrmLandingDocument } from '../../../../../public/dynamic-landing/blocks/landing-blocks.types';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import type { CrmLandingState } from '../../crm/models/crm.model';
import { CrmService } from '../../crm/services/crm.service';
import { ProductsService } from '../../products/services/products.service';
import type { StoreAppDetail } from '../interfaces/store-app.interface';
import { StoreAppsService } from '../services/store-apps.service';
import { BuilderPreviewPaneComponent } from '../builder/builder-preview-pane.component';
import type { BuilderDevice } from '../builder/builder.types';
import { LandingBuilderPageComponent } from './landing-builder-page.component';

/** The real pane loads the frame route in an iframe; the spec only checks what it receives. */
@Component({ selector: 'app-builder-preview-pane', standalone: true, template: '<div data-testid="preview-pane"></div>' })
class StubPreviewPane {
  readonly frameSrc = input<string>('');
  readonly payload = input<unknown>(null);
  readonly selectedBlockId = input<string | null>(null);
  readonly device = model<BuilderDevice>('mobile');
  readonly blockSelect = output<string>();
}

const DOC: CrmLandingDocument = {
  schema_version: 1,
  theme: { primary_color: '#1E40AF' },
  blocks: [
    { id: 'hero_1', type: 'hero', props: { title: 'Bienvenidos' } },
    { id: 'faq_1', type: 'faq', props: { items: [{ question: '¿Envían?', answer: 'Sí' }] } },
    { id: 'contact_1', type: 'contact', props: {} },
  ],
};

function crmState(over: Partial<CrmLandingState> = {}): CrmLandingState {
  return {
    enabled: true,
    generation_status: 'ready',
    content_json: DOC,
    published_json: DOC,
    published_at: '2026-10-01T00:00:00Z',
    version: 1,
    last_job_id: null,
    ...over,
  };
}

function appDetail(over: Partial<StoreAppDetail> = {}): StoreAppDetail {
  return {
    key: 'landing',
    name: 'Landing page',
    description: '',
    applies_to_store_industries: true,
    status: 'published',
    enabled: true,
    domain: { id: 7, hostname: 'promo.mitienda.com', status: 'active' },
    public_url: 'https://promo.mitienda.com',
    config: { offer_mode: 'info', offer_title: null, offer_description: null, offer_product_id: null },
    ...over,
  } as StoreAppDetail;
}

describe('LandingBuilderPageComponent (F6-A)', () => {
  let fixture: ComponentFixture<LandingBuilderPageComponent>;
  let page: LandingBuilderPageComponent;
  let crm: jasmine.SpyObj<CrmService>;
  let apps: jasmine.SpyObj<StoreAppsService>;
  let calls: string[];

  async function render(state = crmState(), detail = appDetail()): Promise<void> {
    calls = [];
    crm = jasmine.createSpyObj('CrmService', ['getLanding', 'saveDraft', 'publish', 'activate', 'getGenerationJobStatus', 'getPreviewContext']);
    apps = jasmine.createSpyObj('StoreAppsService', [
      'get',
      'activate',
      'deactivate',
      'saveLandingConfig',
      'publishLanding',
      'unpublishLanding',
      'landingCustomDomains',
    ]);
    crm.getLanding.and.returnValue(of({ success: true, data: state }));
    crm.getPreviewContext.and.returnValue(
      of({ success: true, data: { products: [], ecommerce_base_url: 'https://mitienda.vendix.online' } }),
    );
    crm.saveDraft.and.callFake((content) => {
      calls.push('saveDraft');
      return of({ success: true, data: crmState({ content_json: content }) });
    });
    crm.publish.and.callFake(() => {
      calls.push('crm.publish');
      return of({ success: true, data: crmState() });
    });
    apps.get.and.returnValue(of({ success: true, data: detail }));
    apps.landingCustomDomains.and.returnValue(
      of({ success: true, data: [{ id: 7, hostname: 'promo.mitienda.com', status: 'active', app_type: 'STORE_LANDING' }] }) as never,
    );
    apps.saveLandingConfig.and.callFake(() => {
      calls.push('saveLandingConfig');
      return of({}) as never;
    });
    apps.publishLanding.and.callFake((id) => {
      calls.push(`publishLanding:${id}`);
      return of({});
    });
    apps.unpublishLanding.and.returnValue(of({}));

    TestBed.configureTestingModule({
      imports: [LandingBuilderPageComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: CrmService, useValue: crm },
        { provide: StoreAppsService, useValue: apps },
        { provide: ProductsService, useValue: jasmine.createSpyObj('ProductsService', ['getProducts', 'getProductById']) },
        { provide: AuthFacade, useValue: { userStoreName: signal('Mi Tienda'), userStore: signal({ logo_url: null }) } },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success', 'error', 'info']) },
      ],
    });
    TestBed.overrideComponent(LandingBuilderPageComponent, {
      remove: { imports: [BuilderPreviewPaneComponent] },
      add: { imports: [StubPreviewPane] },
    });
    fixture = TestBed.createComponent(LandingBuilderPageComponent);
    page = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const actionIds = () => page.actions().map((a) => a.id);
  const stickyHeaders = () => el().querySelectorAll('app-sticky-header').length;

  afterEach(() => TestBed.resetTestingModule());

  it('una sola barra con las cinco pestañas y el estado; nada que guardar ni publicar si está al día', async () => {
    await render();

    expect(stickyHeaders()).toBe(1);
    expect(page.tabs.map((t) => t.label)).toEqual(['General', 'Contenido', 'Estilo', 'SEO', 'Vista previa']);
    expect(page.tab()).toBe('content');
    expect(page.badge()?.label).toBe('Publicada');
    expect(page.subtitle()).toBe('https://promo.mitienda.com');
    // Publicada en su dominio y sin cambios: solo Despublicar.
    expect(actionIds()).toEqual(['unpublish']);
    // Índice, inspector y vista previa en la misma pantalla.
    expect(el().querySelector('[data-testid="builder-outline"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="builder-inspector"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="preview-pane"]')).not.toBeNull();
  });

  it('editar un campo marca cambios: aparece Guardar y Publicar cambios', async () => {
    await render();

    page.setProp({ blockId: 'hero_1', key: 'title', value: 'Nueva portada' });
    fixture.detectChanges();

    expect(page.subtitle()).toContain('Cambios sin guardar');
    expect(actionIds()).toEqual(['save', 'unpublish', 'publish']);
    expect(page.actions().find((a) => a.id === 'publish')?.label).toBe('Publicar cambios');
  });

  it('Guardar persiste el borrador sin ítems vacíos y no publica', async () => {
    await render();
    page.setProp({ blockId: 'faq_1', key: 'items', value: [{ question: '¿Envían?', answer: 'Sí' }, { question: '', answer: '' }] });

    page.onAction('save');
    await fixture.whenStable();

    expect(calls).toEqual(['saveDraft']);
    const saved = crm.saveDraft.calls.mostRecent().args[0] as CrmLandingDocument;
    expect(saved.blocks[1].props['items']).toEqual([{ question: '¿Envían?', answer: 'Sí' }]);
    expect(page.dirty()).toBeFalse();
  });

  it('Ctrl/Cmd+S guarda cuando hay cambios', async () => {
    await render();
    page.toggleHidden('faq_1');

    const event = new KeyboardEvent('keydown', { key: 's', metaKey: true, cancelable: true });
    document.dispatchEvent(event);
    await fixture.whenStable();

    expect(event.defaultPrevented).toBeTrue();
    expect(crm.saveDraft).toHaveBeenCalledTimes(1);
  });

  it('Publicar hace la cadena completa una vez: borrador, contenido, oferta y dominio', async () => {
    await render();
    page.setProp({ blockId: 'hero_1', key: 'title', value: 'Otra' });

    page.onAction('publish');
    await fixture.whenStable();

    expect(calls).toEqual(['saveDraft', 'crm.publish', 'saveLandingConfig', 'publishLanding:7']);
  });

  it('sin secciones visibles no se puede publicar y el botón dice por qué', async () => {
    await render(crmState({ published_json: null }), appDetail({ status: 'draft', domain: null }));
    for (const id of ['hero_1', 'faq_1', 'contact_1']) page.toggleHidden(id);

    const publish = page.actions().find((a) => a.id === 'publish')!;
    expect(publish.label).toBe('Publicar');
    expect(publish.disabled).toBeTrue();
    expect(publish.title).toBe('Agrega al menos una sección visible.');
  });

  it('apagada: abre en General y Publicar pide encenderla primero', async () => {
    await render(crmState({ published_json: null }), appDetail({ status: 'disabled', domain: null }));

    expect(page.tab()).toBe('general');
    expect(el().querySelector('[data-testid="landing-activate"]')).not.toBeNull();
    expect(page.actions().find((a) => a.id === 'publish')?.title).toBe('Enciende la landing en General para publicarla.');
    expect(actionIds()).not.toContain('unpublish');
  });

  it('sin dominio propio no ofrece Despublicar', async () => {
    await render(crmState(), appDetail({ domain: null, public_url: null }));

    expect(actionIds()).not.toContain('unpublish');
  });

  it('constructor: agrega desde el catálogo debajo de la seleccionada y la selecciona', async () => {
    await render();
    page.selectedId.set('hero_1');

    page.addBlock('about');

    expect(page.blocks().map((b) => b.type)).toEqual(['hero', 'about', 'faq', 'contact']);
    expect(page.selectedBlock()?.type).toBe('about');
  });

  it('constructor: Alt+↓ mueve la sección seleccionada', async () => {
    await render();
    page.selectedId.set('hero_1');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, cancelable: true }));

    expect(page.blocks().map((b) => b.id)).toEqual(['faq_1', 'hero_1', 'contact_1']);
  });

  it('constructor: eliminar pide confirmar en la misma fila y luego selecciona la siguiente', async () => {
    await render();
    page.selectedId.set('faq_1');
    fixture.detectChanges();

    const row = el().querySelector('[data-block-id="faq_1"]') as HTMLElement;
    (row.querySelector('[data-testid="builder-remove"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(page.blocks().length).toBe(3);
    (row.querySelector('[data-testid="builder-confirm-delete"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(page.blocks().map((b) => b.id)).toEqual(['hero_1', 'contact_1']);
    expect(page.selectedId()).toBe('contact_1');
  });

  it('constructor: una sección única no se puede duplicar', async () => {
    await render();
    fixture.detectChanges();

    const dup = (id: string) =>
      el().querySelector(`[data-block-id="${id}"] [data-testid="builder-duplicate"]`) as HTMLButtonElement;
    expect(dup('hero_1').disabled).toBeTrue();
    expect(dup('faq_1').disabled).toBeFalse();
  });

  it('la vista previa recibe el borrador, los datos reales de la tienda y la oferta', async () => {
    await render();
    page.patchTheme({ primary_color: '#059669' });
    fixture.detectChanges();

    const payload = page.previewPayload();
    expect(payload.document.theme?.primary_color).toBe('#059669');
    expect(payload.context.ecommerce_base_url).toBe('https://mitienda.vendix.online');
    expect(payload.offer?.title).toBe('Déjanos tus datos y te contactamos');
    expect(payload.storeName).toBe('Mi Tienda');
  });

  it('SEO vacío no deja la clave en el documento', async () => {
    await render();

    page.setSeo({ title: 'Promo' });
    expect(page.draft().seo).toEqual({ title: 'Promo' });
    page.setSeo({});
    expect('seo' in page.draft()).toBeFalse();
    expect(page.dirty()).toBeFalse();
  });
});
