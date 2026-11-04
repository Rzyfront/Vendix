import { Component, input, model, output, provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { ProductsService } from '../../../products/services/products.service';
import { BuilderPreviewPaneComponent } from '../../builder/builder-preview-pane.component';
import type { BuilderDevice } from '../../builder/builder.types';
import type { ProductPageCustomDomain, StoreAppDetail } from '../../interfaces/store-app.interface';
import { StoreAppsService } from '../../services/store-apps.service';
import { APP_PAGE_TEMPLATES, AppPageDocument } from '../../templates';
import { AppPageBuilderPageComponent } from '../app-page-builder-page.component';
import { blocksToPage, pageToBlocks } from '../page-builder-document';
import {
  SERVICE_PAGE_BUILDER_CATALOG,
  ServicePageContext,
  ServicePageSettings,
  servicePagePreview,
} from './service-page-builder';
import { ServicePageBuilderPageComponent, modeOf } from './service-page-builder-page.component';

/** The real pane loads the frame route in an iframe; the spec only checks what it receives. */
@Component({ selector: 'app-builder-preview-pane', standalone: true, template: '<div data-testid="preview-pane"></div>' })
class StubPreviewPane {
  readonly frameSrc = input<string>('');
  readonly payload = input<unknown>(null);
  readonly selectedBlockId = input<string | null>(null);
  readonly device = model<BuilderDevice>('mobile');
  readonly blockSelect = output<string>();
}

const svc = (id: number, name: string, over: Partial<ServicePageContext['services'][number]> = {}) => ({
  id,
  slug: `s-${id}`,
  name,
  description: null,
  price: 50000,
  image_url: null,
  service_duration_minutes: 60,
  service_modality: 'in_person',
  requires_booking: true,
  categories: [],
  ...over,
});

const CONTEXT: ServicePageContext = {
  services: [
    svc(1, 'Facial', { categories: [{ id: 9, name: 'Rostro', slug: 'rostro' }] }),
    svc(2, 'Masaje', { categories: [{ id: 8, name: 'Cuerpo', slug: 'cuerpo' }] }),
    svc(3, 'Uñas'),
  ],
  featured_service_ids: [2],
  products: [{ id: 7, slug: 'crema', name: 'Crema', image_url: 'https://img/crema.jpg' }],
};

const DOMAINS: ProductPageCustomDomain[] = [{ id: 5, hostname: 'spa.com' } as ProductPageCustomDomain];

const item = (id: number, name: string, type = 'service') => ({ id, name, slug: name.toLowerCase(), product_type: type, available_for_ecommerce: true });

function appDetail(over: Partial<StoreAppDetail> = {}): StoreAppDetail {
  return {
    key: 'service_page',
    name: 'Página de servicios',
    description: '',
    applies_to_store_industries: true,
    status: 'draft',
    enabled: true,
    domain: null,
    public_url: 'https://mitienda-service.vendix.online',
    published_at: null,
    config: { featured_service_ids: [2], product_ids: [7] },
    ...over,
  } as StoreAppDetail;
}

describe('ServicePageBuilderPageComponent (F6-B)', () => {
  let fixture: ComponentFixture<ServicePageBuilderPageComponent>;
  let apps: jasmine.SpyObj<StoreAppsService>;
  let calls: string[];

  async function render(detail = appDetail()): Promise<void> {
    calls = [];
    apps = jasmine.createSpyObj('StoreAppsService', [
      'get',
      'activate',
      'deactivate',
      'savePage',
      'saveServicePageConfig',
      'servicePagePreviewContext',
      'servicePageCustomDomains',
      'publishServicePage',
      'unpublishServicePage',
    ]);
    apps.get.and.returnValue(of({ success: true, data: detail }));
    apps.servicePagePreviewContext.and.returnValue(of({ data: { ...CONTEXT } }));
    apps.servicePageCustomDomains.and.returnValue(of({ data: DOMAINS }));
    apps.savePage.and.callFake((kind, page) => {
      calls.push(`savePage:${kind}`);
      return of({ success: true, data: { page } });
    });
    apps.saveServicePageConfig.and.callFake(() => {
      calls.push('saveServicePageConfig');
      return of({});
    });
    apps.publishServicePage.and.callFake((id) => {
      calls.push(`publishServicePage:${id}`);
      return of({});
    });
    apps.unpublishServicePage.and.returnValue(of({}));
    const products = jasmine.createSpyObj('ProductsService', ['getProductById', 'getProducts']);
    products.getProductById.and.callFake((id: number) => of(id === 2 ? item(2, 'Masaje') : item(7, 'Crema', 'physical')));
    products.getProducts.and.returnValue(of({ data: [item(3, 'Uñas')] }));
    TestBed.configureTestingModule({
      imports: [ServicePageBuilderPageComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: StoreAppsService, useValue: apps },
        { provide: ProductsService, useValue: products },
        { provide: AuthFacade, useValue: { userStoreName: signal('Mi Tienda'), userStore: signal({ logo_url: null }) } },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success', 'error', 'info']) },
      ],
    });
    TestBed.overrideComponent(AppPageBuilderPageComponent, {
      remove: { imports: [BuilderPreviewPaneComponent] },
      add: { imports: [StubPreviewPane] },
    });
    fixture = TestBed.createComponent(ServicePageBuilderPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const builder = () =>
    fixture.debugElement.children[0].componentInstance as AppPageBuilderPageComponent<ServicePageSettings, ServicePageContext>;
  const actionIds = () => builder().actions().map((a) => a.id);
  const refresh = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const click = async (testid: string) => {
    (el().querySelector(`[data-testid="${testid}"]`) as HTMLElement).click();
    await refresh();
  };

  afterEach(() => TestBed.resetTestingModule());

  it('una sola barra con las cinco pestañas; sin página propia queda igual que hoy (modo reserva + compra) y no hay nada que guardar', async () => {
    await render();

    expect(el().querySelectorAll('app-sticky-header').length).toBe(1);
    expect(builder().tabs.map((t) => t.label)).toEqual(['General', 'Contenido', 'Estilo', 'SEO', 'Vista previa']);
    expect(builder().blocks().map((b) => b.id)).toEqual(['hero']);
    expect(builder().page()).toEqual({ schema_version: 1, blocks: [] });
    expect(builder().mode()).toBe('both');
    expect(builder().dirty()).toBeFalse();
    expect(actionIds()).toEqual(['publish']);
    expect(builder().subtitle()).toBe('https://mitienda-service.vendix.online');
    expect(builder().settings()).toEqual({ featured: [{ id: 2, name: 'Masaje' }], products: [{ id: 7, name: 'Crema' }] });
  });

  it('editar la portada pide Guardar; Guardar envía solo la página y queda al día', async () => {
    await render();

    builder().setProp({ blockId: 'hero', key: 'title', value: 'Cuida tu piel' });
    await refresh();
    expect(actionIds()).toEqual(['save', 'publish']);
    expect(builder().subtitle()).toContain('Cambios sin guardar');

    builder().save();
    await refresh();
    expect(calls).toEqual(['savePage:service_page']);
    expect(apps.savePage.calls.mostRecent().args[1]).toEqual({ schema_version: 1, blocks: [], hero: { title: 'Cuida tu piel' } });
    expect(builder().dirty()).toBeFalse();
  });

  it('publicada: los cambios se publican en vivo («Publicar cambios»), sin volver a publicar la app', async () => {
    await render(appDetail({ status: 'published' }));
    expect(actionIds()).toEqual(['unpublish']);

    builder().addBlock('faq');
    await refresh();
    const publish = builder().actions().find((a) => a.id === 'publish');
    expect(actionIds()).toEqual(['unpublish', 'publish']);
    expect(publish?.label).toBe('Publicar cambios');
    expect(builder().subtitle()).toContain('Cambios sin publicar');

    builder().onAction('publish');
    await refresh();
    expect(calls).toEqual(['savePage:service_page']);
  });

  it('borrador: Publicar guarda lo pendiente y publica con el dominio elegido', async () => {
    await render();
    builder().setProp({ blockId: 'hero', key: 'title', value: 'Hola' });
    builder().customDomainId.set(5);

    builder().onAction('publish');
    await refresh();
    expect(calls).toEqual(['savePage:service_page', 'publishServicePage:5']);
  });

  it('Servicios queda anclado tras la portada y Productos al final; ninguno se puede quitar (la página los muestra aunque falte el bloque)', async () => {
    await render();
    const services = SERVICE_PAGE_BUILDER_CATALOG.blocks.find((b) => b.type === 'services');
    const products = SERVICE_PAGE_BUILDER_CATALOG.blocks.find((b) => b.type === 'products');
    expect(services?.pinned).toBe('start');
    expect(services?.removable).toBeFalse();
    expect(products?.pinned).toBe('end');
    expect(products?.removable).toBeFalse();

    builder().addBlock('products');
    builder().addBlock('faq');
    builder().addBlock('services');
    expect(builder().blocks().map((b) => b.type)).toEqual(['hero', 'services', 'faq', 'products']);
    builder().move(1, 3);
    builder().move(3, 1);
    expect(builder().blocks().map((b) => b.type)).toEqual(['hero', 'services', 'faq', 'products']);
  });

  it('el catálogo se filtra por modo: «Cómo reservar» y «Políticas» solo si reserva; «También puedes comprar» solo si vende', async () => {
    await render();
    const typesFor = (mode: 'booking' | 'sales' | 'both' | 'info') =>
      SERVICE_PAGE_BUILDER_CATALOG.blocks.filter((b) => !b.modes || b.modes.includes(mode)).map((b) => b.type);

    expect(typesFor('both')).toEqual(jasmine.arrayContaining(['how_it_works', 'policies', 'products']));
    expect(typesFor('booking')).toContain('how_it_works');
    expect(typesFor('booking')).not.toContain('products');
    expect(typesFor('sales')).toContain('products');
    expect(typesFor('sales')).not.toContain('how_it_works');
    expect(typesFor('info')).not.toContain('how_it_works');
    expect(typesFor('info')).not.toContain('products');
    expect(typesFor('info')).toContain('services');
  });

  it('General: agenda y compra van al contrato de la página (mode, sales.show_cart)', async () => {
    await render();
    builder().setTab('general');
    await refresh();

    await click('service-page-sells');
    expect(builder().page().mode).toBe('booking');
    expect(el().querySelector('[data-testid="service-page-show-cart"]')).toBeNull();

    await click('service-page-books');
    expect(builder().page().mode).toBe('info');
    await click('service-page-sells');
    expect(builder().page().mode).toBe('sales');
    await click('service-page-books');
    expect(builder().page().mode).toBe('both');

    await click('service-page-show-cart');
    expect(builder().page().sales).toEqual({ show_cart: false });
  });

  it('General: muestra la agrupación por categorías que ve el cliente', async () => {
    await render();
    builder().setTab('general');
    await refresh();

    expect(el().querySelector('[data-testid="service-page-categories"]')?.textContent).toContain('Rostro');
    expect(el().querySelector('[data-testid="service-page-categories"]')?.textContent).toContain('Cuerpo');
  });

  it('General: cambiar destacados o productos pide Guardar y se guarda con saveServicePageConfig', async () => {
    await render();
    builder().setTab('general');
    await refresh();

    (el().querySelector('[data-testid="service-page-product-7"] button') as HTMLButtonElement).click();
    await refresh();
    expect(builder().settings()?.products).toEqual([]);
    expect(actionIds()).toEqual(['save', 'publish']);

    builder().save();
    await refresh();
    expect(calls).toEqual(['saveServicePageConfig']);
    expect(apps.saveServicePageConfig).toHaveBeenCalledWith({ featured_service_ids: [2], product_ids: [] });
  });

  it('General: quitar un destacado desde su chip actualiza los ajustes', async () => {
    await render();
    builder().setTab('general');
    await refresh();

    (el().querySelector('[data-testid="service-page-featured-2"] button') as HTMLButtonElement).click();
    await refresh();
    expect(builder().settings()?.featured).toEqual([]);
  });

  it('una plantilla reemplaza portada, secciones y estilo y conserva la marca', async () => {
    await render();
    builder().setBrand('whatsapp_number', '+573001234567');
    builder().applyTemplate({ id: 'base', name: 'Base', description: '', page: APP_PAGE_TEMPLATES.service_page.page });

    expect(builder().page().blocks.map((b) => b.type)).toContain('policies');
    expect(builder().page().brand?.whatsapp_number).toBe('+573001234567');
  });
});

describe('service page builder document (F6-B)', () => {
  const payload = (page: AppPageDocument, settings: ServicePageSettings | null, context: ServicePageContext | null = CONTEXT) => ({
    kind: 'service_page' as const,
    page,
    settings,
    context,
    storeName: 'Mi Tienda',
    storeLogoUrl: null,
  });
  const empty: AppPageDocument = { schema_version: 1, blocks: [] };

  it('una página guardada vuelve idéntica tras pasar por el constructor', () => {
    const page: AppPageDocument = {
      ...APP_PAGE_TEMPLATES.service_page.page,
      hero: { title: 'Hola' },
      brand: { whatsapp_number: '+573001234567' },
    };
    const back = blocksToPage('service_page', SERVICE_PAGE_BUILDER_CATALOG, { ...page, blocks: [] }, pageToBlocks(page));
    expect(back).toEqual(page);
  });

  it('modeOf combina agenda y compra', () => {
    expect([modeOf(true, true), modeOf(true, false), modeOf(false, true), modeOf(false, false)]).toEqual(['both', 'booking', 'sales', 'info']);
  });

  it('vista previa: destacados primero en el orden del dueño y el resto por nombre, como la página pública', () => {
    const view = servicePagePreview(payload(empty, { featured: [{ id: 3, name: 'Uñas' }, { id: 2, name: 'Masaje' }], products: [] }));
    expect(view.services.map((s) => s.id)).toEqual([3, 2, 1]);
    expect(view.featuredIds).toEqual([3, 2]);
    expect(servicePagePreview(payload(empty, { featured: [], products: [] })).services.map((s) => s.id)).toEqual([1, 2, 3]);
  });

  it('vista previa: usa el precio del servidor y la foto de los productos que ya conoce', () => {
    const view = servicePagePreview(payload(empty, { featured: [], products: [{ id: 7, name: 'Crema' }, { id: 99, name: 'Nuevo' }] }));
    expect(view.services[0].final_price).toBe(50000);
    expect(view.products).toEqual([
      { id: 7, name: 'Crema', image_url: 'https://img/crema.jpg' },
      { id: 99, name: 'Nuevo', image_url: null },
    ]);
  });

  it('vista previa: sin contexto no dibuja servicios y no falla', () => {
    expect(servicePagePreview(payload(empty, null, null)).services).toEqual([]);
  });
});
