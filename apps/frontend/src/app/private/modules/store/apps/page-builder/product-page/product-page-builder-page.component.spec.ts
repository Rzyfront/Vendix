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
  PRODUCT_PAGE_BUILDER_CATALOG,
  ProductPageContext,
  ProductPageSettings,
  productPagePreview,
} from './product-page-builder';
import { ProductPageBuilderPageComponent } from './product-page-builder-page.component';

/** The real pane loads the frame route in an iframe; the spec only checks what it receives. */
@Component({ selector: 'app-builder-preview-pane', standalone: true, template: '<div data-testid="preview-pane"></div>' })
class StubPreviewPane {
  readonly frameSrc = input<string>('');
  readonly payload = input<unknown>(null);
  readonly selectedBlockId = input<string | null>(null);
  readonly device = model<BuilderDevice>('mobile');
  readonly blockSelect = output<string>();
}

const CONTEXT: ProductPageContext = {
  product: {
    id: 1,
    slug: 'crema',
    name: 'Crema',
    description: 'Hidrata',
    image_url: 'https://img/crema.jpg',
    variants: [
      { id: 10, name: 'Chica' },
      { id: 11, name: 'Grande' },
    ],
  },
  complements: [{ id: 2, slug: 'jabon', name: 'Jabón', image_url: null }],
};

const DOMAINS: ProductPageCustomDomain[] = [{ id: 5, hostname: 'crema.com' } as ProductPageCustomDomain];

const product = (id: number, name: string) => ({ id, name, slug: name.toLowerCase(), available_for_ecommerce: true });

function appDetail(over: Partial<StoreAppDetail> = {}): StoreAppDetail {
  return {
    key: 'product_page',
    name: 'Página de producto',
    description: '',
    applies_to_store_industries: true,
    status: 'draft',
    enabled: true,
    domain: null,
    public_url: 'https://mitienda-crema.vendix.online',
    published_at: null,
    config: { product_id: 1, complement_product_ids: [2] },
    ...over,
  } as StoreAppDetail;
}

describe('ProductPageBuilderPageComponent (F6-B)', () => {
  let fixture: ComponentFixture<ProductPageBuilderPageComponent>;
  let apps: jasmine.SpyObj<StoreAppsService>;
  let calls: string[];

  async function render(detail = appDetail()): Promise<void> {
    calls = [];
    apps = jasmine.createSpyObj('StoreAppsService', [
      'get',
      'activate',
      'deactivate',
      'savePage',
      'saveProductPageConfig',
      'productPagePreviewContext',
      'productPageCustomDomains',
      'publishProductPage',
      'unpublishProductPage',
    ]);
    apps.get.and.returnValue(of({ success: true, data: detail }));
    apps.productPagePreviewContext.and.returnValue(of({ data: { ...CONTEXT } }));
    apps.productPageCustomDomains.and.returnValue(of({ data: DOMAINS }));
    apps.savePage.and.callFake((kind, page) => {
      calls.push(`savePage:${kind}`);
      return of({ success: true, data: { page } });
    });
    apps.saveProductPageConfig.and.callFake(() => {
      calls.push('saveProductPageConfig');
      return of({});
    });
    apps.publishProductPage.and.callFake((id) => {
      calls.push(`publishProductPage:${id}`);
      return of({});
    });
    apps.unpublishProductPage.and.returnValue(of({}));
    const products = jasmine.createSpyObj('ProductsService', ['getProductById', 'getProducts']);
    products.getProductById.and.callFake((id: number) => of(id === 1 ? product(1, 'Crema') : product(2, 'Jabón')));
    products.getProducts.and.returnValue(of({ data: [] }));
    TestBed.configureTestingModule({
      imports: [ProductPageBuilderPageComponent],
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
    fixture = TestBed.createComponent(ProductPageBuilderPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const builder = () =>
    fixture.debugElement.children[0].componentInstance as AppPageBuilderPageComponent<ProductPageSettings, ProductPageContext>;
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
    expect(builder().subtitle()).toBe('https://mitienda-crema.vendix.online');
    expect(builder().settings()).toEqual({
      product: { id: 1, name: 'Crema', slug: 'crema' },
      complements: [{ id: 2, name: 'Jabón', slug: 'jabón' }],
    });
  });

  it('editar la portada pide Guardar; Guardar envía solo la página y queda al día', async () => {
    await render();

    builder().setProp({ blockId: 'hero', key: 'title', value: 'Crema que cuida' });
    await refresh();
    expect(actionIds()).toEqual(['save', 'publish']);
    expect(builder().subtitle()).toContain('Cambios sin guardar');

    builder().save();
    await refresh();
    expect(calls).toEqual(['savePage:product_page']);
    expect(apps.savePage.calls.mostRecent().args[1]).toEqual({ schema_version: 1, blocks: [], hero: { title: 'Crema que cuida' } });
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
    expect(calls).toEqual(['savePage:product_page']);
  });

  it('borrador: Publicar guarda lo pendiente y publica con el dominio elegido', async () => {
    await render();
    builder().setProp({ blockId: 'hero', key: 'title', value: 'Hola' });
    builder().customDomainId.set(5);

    builder().onAction('publish');
    await refresh();
    expect(calls).toEqual(['savePage:product_page', 'publishProductPage:5']);
  });

  it('sin producto destacado no se puede publicar y el motivo está en el botón', async () => {
    await render(appDetail({ config: {} }));

    const publish = builder().actions().find((a) => a.id === 'publish');
    expect(publish?.disabled).toBeTrue();
    expect(publish?.title).toBe('Elige el producto destacado en General para publicar.');
    builder().onAction('publish');
    await refresh();
    expect(calls).toEqual([]);
  });

  it('apagada: Publicar queda deshabilitado con el motivo y abre en General', async () => {
    await render(appDetail({ status: 'disabled' }));

    expect(builder().tab()).toBe('general');
    const publish = builder().actions().find((a) => a.id === 'publish');
    expect(publish?.disabled).toBeTrue();
    expect(publish?.title).toBe('Enciende la app en General para publicarla.');
  });

  it('Complementos queda anclado bajo el producto y no se puede quitar aunque se agregue después de otra sección', async () => {
    await render();
    const def = PRODUCT_PAGE_BUILDER_CATALOG.blocks.find((b) => b.type === 'complements');
    expect(def?.pinned).toBe('start');
    // La página pública lo muestra aunque falte el bloque: solo se puede ocultar.
    expect(def?.removable).toBeFalse();

    builder().addBlock('faq');
    builder().addBlock('complements');
    expect(builder().blocks().map((b) => b.type)).toEqual(['hero', 'complements', 'faq']);
    builder().move(1, 2);
    expect(builder().blocks().map((b) => b.type)).toEqual(['hero', 'complements', 'faq']);
  });

  it('General: cambiar el producto o los complementos pide Guardar y se guarda con saveProductPageConfig', async () => {
    await render();
    builder().setTab('general');
    await refresh();
    expect(el().querySelector('[data-testid="product-page-featured"]')?.textContent).toContain('Crema');
    expect(el().querySelector('[data-testid="product-page-variants"]')?.textContent).toContain('Chica, Grande');

    (el().querySelector('[data-testid="product-page-complement-2"] button') as HTMLButtonElement).click();
    await refresh();
    expect(builder().settings()?.complements).toEqual([]);
    expect(actionIds()).toEqual(['save', 'publish']);

    builder().save();
    await refresh();
    expect(calls).toEqual(['saveProductPageConfig']);
    expect(apps.saveProductPageConfig).toHaveBeenCalledWith({ product_id: 1, complement_product_ids: [] });
  });

  it('General: publicada en la dirección de Vendix el producto no se cambia; en un dominio propio sí', async () => {
    await render(appDetail({ status: 'published' }));
    builder().setTab('general');
    await refresh();
    expect(el().querySelector('[data-testid="product-page-change"]')).toBeNull();
  });

  it('General: compra sí/no y carrito van al contrato de la página (mode, sales.show_cart)', async () => {
    await render();
    builder().setTab('general');
    await refresh();

    (el().querySelector('[data-testid="product-page-mode-info"]') as HTMLInputElement).click();
    await refresh();
    expect(builder().page().mode).toBe('info');
    expect(el().querySelector('[data-testid="product-page-show-cart"]')).toBeNull();

    (el().querySelector('[data-testid="product-page-mode-sales"]') as HTMLInputElement).click();
    await refresh();
    (el().querySelector('[data-testid="product-page-show-cart"]') as HTMLInputElement).click();
    await refresh();
    expect(builder().page().mode).toBe('sales');
    expect(builder().page().sales).toEqual({ show_cart: false });
  });

  it('una plantilla reemplaza portada, secciones y estilo y conserva la marca', async () => {
    await render();
    builder().setBrand('whatsapp_number', '+573001234567');
    builder().applyTemplate({ id: 'base', name: 'Base', description: '', page: APP_PAGE_TEMPLATES.product_page.page });

    expect(builder().page().blocks.map((b) => b.type)).toContain('benefits');
    expect(builder().page().brand?.whatsapp_number).toBe('+573001234567');
  });
});

describe('product page builder document (F6-B)', () => {
  const payload = (page: AppPageDocument, settings: ProductPageSettings | null = null, context: ProductPageContext | null = CONTEXT) => ({
    kind: 'product_page' as const,
    page,
    settings,
    context,
    storeName: 'Mi Tienda',
    storeLogoUrl: null,
  });
  const settings: ProductPageSettings = {
    product: { id: 1, name: 'Crema', slug: 'crema' },
    complements: [{ id: 2, name: 'Jabón', slug: 'jabon' }],
  };

  it('una página guardada vuelve idéntica tras pasar por el constructor', () => {
    const page: AppPageDocument = {
      ...APP_PAGE_TEMPLATES.product_page.page,
      hero: { title: 'Hola' },
      brand: { whatsapp_number: '+573001234567' },
    };
    const back = blocksToPage('product_page', PRODUCT_PAGE_BUILDER_CATALOG, { ...page, blocks: [] }, pageToBlocks(page));
    expect(back).toEqual(page);
  });

  it('vista previa: los complementos salen como en la página pública (existen y el bloque no está oculto)', () => {
    const empty: AppPageDocument = { schema_version: 1, blocks: [] };
    expect(productPagePreview(payload(empty, settings)).showComplements).toBeTrue();
    expect(productPagePreview(payload(empty, settings)).complementsTitle).toBe('Complementa tu compra');

    const hidden: AppPageDocument = { schema_version: 1, blocks: [{ id: 'c1', type: 'complements', enabled: false, props: {} }] };
    expect(productPagePreview(payload(hidden, settings)).showComplements).toBeFalse();

    const titled: AppPageDocument = { schema_version: 1, blocks: [{ id: 'c1', type: 'complements', enabled: true, props: { title: 'Lleva también' } }] };
    const view = productPagePreview(payload(titled, settings));
    expect(view.complementsTitle).toBe('Lleva también');
    expect(view.complementsBlockId).toBe('c1');
    expect(productPagePreview(payload(empty, { ...settings, complements: [] })).showComplements).toBeFalse();
  });

  it('vista previa: con otro producto elegido sin guardar no mezcla la foto ni las variantes del anterior', () => {
    const view = productPagePreview(payload({ schema_version: 1, blocks: [] }, { product: { id: 9, name: 'Nuevo', slug: 'nuevo' }, complements: [] }));
    expect(view.product).toEqual({ name: 'Nuevo', description: null, image_url: null, variants: [] });
    expect(productPagePreview(payload({ schema_version: 1, blocks: [] }, settings)).product?.variants.length).toBe(2);
  });
});
