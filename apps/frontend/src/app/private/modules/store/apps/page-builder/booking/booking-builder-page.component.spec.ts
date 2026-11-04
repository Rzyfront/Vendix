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
import { BOOKING_BUILDER_CATALOG, BookingContext, BookingSettings, bookingPreview } from './booking-builder';
import { BookingBuilderPageComponent, bookingModeOf } from './booking-builder-page.component';

/** The real pane loads the frame route in an iframe; the spec only checks what it receives. */
@Component({ selector: 'app-builder-preview-pane', standalone: true, template: '<div data-testid="preview-pane"></div>' })
class StubPreviewPane {
  readonly frameSrc = input<string>('');
  readonly payload = input<unknown>(null);
  readonly selectedBlockId = input<string | null>(null);
  readonly device = model<BuilderDevice>('mobile');
  readonly blockSelect = output<string>();
}

const CONTEXT: BookingContext = {
  room_types: [
    { id: 1, name: 'Suite', description: null, max_occupancy: 3, bed_config: '1 doble', image_url: null },
    { id: 2, name: 'Sencilla', description: null, max_occupancy: 1, bed_config: null, image_url: null },
  ],
  products: [{ id: 7, slug: 'desayuno', name: 'Desayuno', image_url: 'https://img/desayuno.jpg' }],
};

const DOMAINS: ProductPageCustomDomain[] = [{ id: 5, hostname: 'hotel.com' } as ProductPageCustomDomain];

const item = (id: number, name: string, type = 'physical') => ({ id, name, slug: name.toLowerCase(), product_type: type, available_for_ecommerce: true });

function appDetail(over: Partial<StoreAppDetail> = {}): StoreAppDetail {
  return {
    key: 'booking',
    name: 'Reservas',
    description: '',
    applies_to_store_industries: true,
    status: 'draft',
    enabled: true,
    domain: null,
    public_url: 'https://mihotel-booking.vendix.online',
    published_at: null,
    config: { product_ids: [7] },
    ...over,
  } as StoreAppDetail;
}

describe('BookingBuilderPageComponent (F6-B)', () => {
  let fixture: ComponentFixture<BookingBuilderPageComponent>;
  let apps: jasmine.SpyObj<StoreAppsService>;
  let calls: string[];

  async function render(detail = appDetail()): Promise<void> {
    calls = [];
    apps = jasmine.createSpyObj('StoreAppsService', [
      'get',
      'activate',
      'deactivate',
      'savePage',
      'saveBookingConfig',
      'bookingPreviewContext',
      'bookingCustomDomains',
      'publishBooking',
      'unpublishBooking',
    ]);
    apps.get.and.returnValue(of({ success: true, data: detail }));
    apps.bookingPreviewContext.and.returnValue(of({ data: { ...CONTEXT } }));
    apps.bookingCustomDomains.and.returnValue(of({ data: DOMAINS }));
    apps.savePage.and.callFake((kind, page) => {
      calls.push(`savePage:${kind}`);
      return of({ success: true, data: { page } });
    });
    apps.saveBookingConfig.and.callFake(() => {
      calls.push('saveBookingConfig');
      return of({});
    });
    apps.publishBooking.and.callFake((id) => {
      calls.push(`publishBooking:${id}`);
      return of({});
    });
    apps.unpublishBooking.and.returnValue(of({}));
    const products = jasmine.createSpyObj('ProductsService', ['getProductById', 'getProducts']);
    products.getProductById.and.callFake((id: number) => of(item(id, 'Desayuno')));
    products.getProducts.and.returnValue(of({ data: [item(3, 'Spa')] }));
    TestBed.configureTestingModule({
      imports: [BookingBuilderPageComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: StoreAppsService, useValue: apps },
        { provide: ProductsService, useValue: products },
        { provide: AuthFacade, useValue: { userStoreName: signal('Mi Hotel'), userStore: signal({ logo_url: null }) } },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success', 'error', 'info']) },
      ],
    });
    TestBed.overrideComponent(AppPageBuilderPageComponent, {
      remove: { imports: [BuilderPreviewPaneComponent] },
      add: { imports: [StubPreviewPane] },
    });
    fixture = TestBed.createComponent(BookingBuilderPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const builder = () =>
    fixture.debugElement.children[0].componentInstance as AppPageBuilderPageComponent<BookingSettings, BookingContext>;
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

  it('una sola barra con las cinco pestañas; sin página propia queda igual que hoy (reserva + compra) y no hay nada que guardar', async () => {
    await render();

    expect(el().querySelectorAll('app-sticky-header').length).toBe(1);
    expect(builder().tabs.map((t) => t.label)).toEqual(['General', 'Contenido', 'Estilo', 'SEO', 'Vista previa']);
    expect(builder().blocks().map((b) => b.id)).toEqual(['hero']);
    expect(builder().page()).toEqual({ schema_version: 1, blocks: [] });
    expect(builder().mode()).toBe('both');
    expect(builder().dirty()).toBeFalse();
    expect(actionIds()).toEqual(['publish']);
    expect(builder().subtitle()).toBe('https://mihotel-booking.vendix.online');
    expect(builder().settings()).toEqual({ products: [{ id: 7, name: 'Desayuno' }] });
  });

  it('editar la portada pide Guardar; Guardar envía solo la página y queda al día', async () => {
    await render();

    builder().setProp({ blockId: 'hero', key: 'title', value: 'Descansa aquí' });
    await refresh();
    expect(actionIds()).toEqual(['save', 'publish']);
    expect(builder().subtitle()).toContain('Cambios sin guardar');

    builder().save();
    await refresh();
    expect(calls).toEqual(['savePage:booking']);
    expect(apps.savePage.calls.mostRecent().args[1]).toEqual({ schema_version: 1, blocks: [], hero: { title: 'Descansa aquí' } });
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
    expect(calls).toEqual(['savePage:booking']);
  });

  it('borrador: Publicar guarda lo pendiente y publica con el dominio elegido', async () => {
    await render();
    builder().setProp({ blockId: 'hero', key: 'title', value: 'Hola' });
    builder().customDomainId.set(5);

    builder().onAction('publish');
    await refresh();
    expect(calls).toEqual(['savePage:booking', 'publishBooking:5']);
  });

  it('Buscador y Check-in quedan anclados tras la portada y Para tu estadía al final; ninguno se puede quitar (la página los muestra aunque falte el bloque)', async () => {
    await render();
    const def = (type: string) => BOOKING_BUILDER_CATALOG.blocks.find((b) => b.type === type);
    expect(def('search')?.pinned).toBe('start');
    expect(def('search')?.removable).toBeFalse();
    expect(def('checkin_info')?.pinned).toBe('start');
    expect(def('checkin_info')?.removable).toBeFalse();
    expect(def('products')?.pinned).toBe('end');
    expect(def('products')?.removable).toBeFalse();

    builder().addBlock('products');
    builder().addBlock('faq');
    builder().addBlock('checkin_info');
    builder().addBlock('search');
    expect(builder().blocks().map((b) => b.type)).toEqual(['hero', 'search', 'checkin_info', 'faq', 'products']);
    builder().move(1, 4);
    builder().move(4, 1);
    expect(builder().blocks().map((b) => b.type)).toEqual(['hero', 'search', 'checkin_info', 'faq', 'products']);
  });

  it('el catálogo se filtra por modo: «Para tu estadía» solo si vende; lo demás siempre', async () => {
    await render();
    const typesFor = (mode: 'booking' | 'sales' | 'both' | 'info') =>
      BOOKING_BUILDER_CATALOG.blocks.filter((b) => !b.modes || b.modes.includes(mode)).map((b) => b.type);

    expect(typesFor('both')).toEqual(jasmine.arrayContaining(['search', 'policies', 'amenities', 'products']));
    expect(typesFor('booking')).not.toContain('products');
    expect(typesFor('booking')).toContain('policies');
    expect(typesFor('sales')).toContain('products');
    expect(typesFor('info')).not.toContain('products');
  });

  it('General: la venta va al contrato de la página (mode, sales.show_cart)', async () => {
    await render();
    builder().setTab('general');
    await refresh();

    expect(el().querySelector('[data-testid="booking-general-rooms"]')?.textContent).toContain('2 tipo(s)');
    expect(el().querySelector('[data-testid="booking-general-rates-link"]')).not.toBeNull();

    await click('booking-sells');
    expect(builder().page().mode).toBe('booking');
    expect(el().querySelector('[data-testid="booking-show-cart"]')).toBeNull();

    await click('booking-sells');
    expect(builder().page().mode).toBe('both');
    await click('booking-show-cart');
    expect(builder().page().sales).toEqual({ show_cart: false });
  });

  it('General: cambiar los productos pide Guardar y se guarda con saveBookingConfig', async () => {
    await render();
    builder().setTab('general');
    await refresh();

    (el().querySelector('[data-testid="booking-product-7"] button') as HTMLButtonElement).click();
    await refresh();
    expect(builder().settings()?.products).toEqual([]);
    expect(actionIds()).toEqual(['save', 'publish']);

    builder().save();
    await refresh();
    expect(calls).toEqual(['saveBookingConfig']);
    expect(apps.saveBookingConfig).toHaveBeenCalledWith({ product_ids: [] });
  });

  it('una plantilla reemplaza portada, secciones y estilo y conserva la marca', async () => {
    await render();
    builder().setBrand('whatsapp_number', '+573001234567');
    builder().applyTemplate({ id: 'base', name: 'Base', description: '', page: APP_PAGE_TEMPLATES.booking.page });

    expect(builder().page().blocks.map((b) => b.type)).toContain('policies');
    expect(builder().page().brand?.whatsapp_number).toBe('+573001234567');
  });
});

describe('booking builder document (F6-B)', () => {
  const payload = (page: AppPageDocument, settings: BookingSettings | null, context: BookingContext | null = CONTEXT) => ({
    kind: 'booking' as const,
    page,
    settings,
    context,
    storeName: 'Mi Hotel',
    storeLogoUrl: null,
  });
  const empty: AppPageDocument = { schema_version: 1, blocks: [] };

  it('una página guardada vuelve idéntica tras pasar por el constructor', () => {
    const page: AppPageDocument = {
      ...APP_PAGE_TEMPLATES.booking.page,
      hero: { title: 'Hola' },
      brand: { whatsapp_number: '+573001234567' },
    };
    const back = blocksToPage('booking', BOOKING_BUILDER_CATALOG, { ...page, blocks: [] }, pageToBlocks(page));
    expect(back).toEqual(page);
  });

  it('bookingModeOf: siempre reserva; la venta decide entre «solo reserva» y «reserva + compra»', () => {
    expect([bookingModeOf(true), bookingModeOf(false)]).toEqual(['both', 'booking']);
  });

  it('vista previa: usa las habitaciones reales y los productos de General con la foto que el servidor ya conoce', () => {
    const view = bookingPreview(payload(empty, { products: [{ id: 7, name: 'Desayuno' }, { id: 99, name: 'Nuevo' }] }));
    expect(view.rooms.map((r) => r.id)).toEqual([1, 2]);
    expect(view.products).toEqual([
      { id: 7, name: 'Desayuno', image_url: 'https://img/desayuno.jpg' },
      { id: 99, name: 'Nuevo', image_url: null },
    ]);
    expect(view.productIds).toEqual([7, 99]);
  });

  it('vista previa: sin contexto no dibuja habitaciones y no falla', () => {
    expect(bookingPreview(payload(empty, null, null)).rooms).toEqual([]);
  });
});
