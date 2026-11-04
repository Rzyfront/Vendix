import { Component, input, provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { HotelSearchComponent } from '../../private/modules/ecommerce/pages/hotel-booking/hotel-search.component';
import { StoreSeoService } from '../../private/modules/ecommerce/services/store-seo';
import { ProductComplementsComponent } from '../product-page/components/product-complements.component';
import { BookingPageHomeComponent } from './booking-page-home.component';
import { BookingPageHomeViewComponent } from './booking-page-home-view.component';
import { BookingPagePublicConfig, BookingPageService } from './booking-page.service';

@Component({ selector: 'app-hotel-search', standalone: true, template: '<p data-testid="pms-search"></p>' })
class SearchStub {}

@Component({ selector: 'app-product-complements', standalone: true, template: '' })
class ComplementsStub {
  readonly productIds = input<number[]>([]);
  readonly title = input('');
  readonly compact = input(false);
}

describe('BookingPageHomeComponent (apps-module Fase 4)', () => {
  let fixture: ComponentFixture<BookingPageHomeComponent>;
  let router: jasmine.SpyObj<Router>;
  const config = signal<BookingPagePublicConfig | null | undefined>(undefined);

  const render = async (page: BookingPagePublicConfig | null, params: Record<string, string> = {}) => {
    config.set(page);
    TestBed.overrideProvider(ActivatedRoute, {
      useValue: {
        snapshot: { queryParamMap: convertToParamMap(params) },
        queryParamMap: of(convertToParamMap(params)),
      },
    });
    fixture = TestBed.createComponent(BookingPageHomeComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };

  beforeEach(() => {
    router = jasmine.createSpyObj('Router', ['navigate']);
    TestBed.configureTestingModule({
      imports: [BookingPageHomeComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: Router, useValue: router },
        { provide: ActivatedRoute, useValue: {} },
        {
          provide: BookingPageService,
          useValue: { config, load: () => of(config()) },
        },
        {
          provide: StoreSeoService,
          useValue: { storeName: signal('Hotel Sol'), origin: 'https://sol-booking.vendix.online', apply: () => {}, release: () => {} },
        },
      ],
    });
    TestBed.overrideComponent(BookingPageHomeViewComponent, {
      remove: { imports: [HotelSearchComponent, ProductComplementsComponent] },
      add: { imports: [SearchStub, ComplementsStub] },
    });
  });

  it('sin fechas en la URL lanza la primera búsqueda (mañana, una noche, dos adultos)', async () => {
    const el = await render({ product_ids: [] });

    expect(el.textContent).toContain('Reserva en Hotel Sol');
    expect(router.navigate).toHaveBeenCalledWith(
      [],
      jasmine.objectContaining({
        replaceUrl: true,
        queryParams: jasmine.objectContaining({ adults: 2, children: 0 }),
      }),
    );
    expect(el.querySelector('[data-testid="pms-search"]')).toBeNull();
  });

  it('con fechas muestra el motor de reservas del PMS y no vuelve a navegar', async () => {
    const el = await render(
      { product_ids: [] },
      { arrival_date: '2026-11-03', departure_date: '2026-11-04' },
    );

    expect(router.navigate).not.toHaveBeenCalled();
    expect(el.querySelector('[data-testid="pms-search"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="booking-page-checkin-info"]')).not.toBeNull();
  });

  it('sin amenidades elegidas no hay bloque secundario', async () => {
    const el = await render({ product_ids: [] }, { arrival_date: '2026-11-03', departure_date: '2026-11-04' });
    expect(el.querySelector('[data-testid="booking-page-products"]')).toBeNull();
  });

  it('las amenidades van debajo de la reserva', async () => {
    const el = await render({ product_ids: [9, 4] }, { arrival_date: '2026-11-03', departure_date: '2026-11-04' });
    const search = el.querySelector('[data-testid="pms-search"]')!;
    const products = el.querySelector('[data-testid="booking-page-products"]')!;
    expect(products).not.toBeNull();
    expect(search.compareDocumentPosition(products) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('sin página publicada muestra «Esta página no está disponible»', async () => {
    const el = await render(null);
    expect(el.querySelector('[data-testid="booking-page-unavailable"]')?.textContent).toContain(
      'Esta página no está disponible',
    );
    expect(router.navigate).not.toHaveBeenCalled();
  });

  const dates = { arrival_date: '2026-11-03', departure_date: '2026-11-04' };
  const ownPage = (over: Record<string, unknown> = {}) =>
    ({
      schema_version: 1,
      mode: 'both',
      hero: { title: 'Descansa en Sol' },
      blocks: [
        { id: 'search', type: 'search', enabled: true, props: { title: 'Encuentra tu cuarto', subtitle: 'Fechas y huéspedes' } },
        { id: 'checkin_info', type: 'checkin_info', enabled: true, props: { text: 'Registra a tus huéspedes antes.' } },
        { id: 'amenities', type: 'amenities', enabled: true, props: { items: ['Wifi'] } },
        { id: 'products', type: 'products', enabled: true, props: { title: 'Extras' } },
      ],
      ...over,
    }) as BookingPagePublicConfig['page'];

  it('sin página propia no hay portada ni bloques propios (DOM de siempre)', async () => {
    const el = await render({ product_ids: [] }, dates);
    expect(el.querySelector('app-app-page-view')).toBeNull();
    expect(el.querySelector('#app-page-main')).toBeNull();
    expect(el.querySelector('[data-testid="booking-page-checkin-info"]')?.textContent).toContain('Check-in en línea.');
  });

  it('con página propia muestra portada, títulos y texto propios y los bloques después de la búsqueda', async () => {
    const el = await render({ product_ids: [3], page: ownPage() }, dates);
    expect(el.querySelector('[data-testid="hero-title"]')?.textContent).toContain('Descansa en Sol');
    expect(el.textContent).toContain('Encuentra tu cuarto');
    expect(el.textContent).toContain('Fechas y huéspedes');
    expect(el.querySelector('[data-testid="booking-page-checkin-info"]')?.textContent).toContain(
      'Registra a tus huéspedes antes.',
    );
    const search = el.querySelector('[data-testid="pms-search"]')!;
    expect(search.compareDocumentPosition(el.querySelector('[data-block="amenities"]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(el.querySelector('[data-testid="booking-page-products"]')).not.toBeNull();
  });

  it('en modo solo reserva oculta los productos', async () => {
    const el = await render({ product_ids: [3], page: ownPage({ mode: 'booking' }) }, dates);
    expect(el.querySelector('[data-testid="booking-page-products"]')).toBeNull();
    expect(el.querySelector('[data-testid="pms-search"]')).not.toBeNull();
  });

  it('sin vista previa no marca secciones; con blockIds marca portada, buscador, check-in y productos y dibuja habitaciones y productos del editor', async () => {
    const el = await render({ product_ids: [3], page: ownPage() }, dates);
    expect(el.querySelector('[data-block-id]')).toBeNull();

    const view = TestBed.createComponent(BookingPageHomeViewComponent);
    view.componentRef.setInput('productIds', [3]);
    view.componentRef.setInput('page', ownPage());
    view.componentRef.setInput('blockIds', true);
    view.componentRef.setInput('previewRooms', [
      { id: 1, name: 'Suite', description: null, max_occupancy: 3, bed_config: '1 doble', image_url: null },
    ]);
    view.componentRef.setInput('previewProducts', [{ id: 3, name: 'Desayuno', image_url: null }]);
    view.detectChanges();
    const root = view.nativeElement as HTMLElement;
    expect(Array.from(root.querySelectorAll('[data-block-id]')).map((e) => e.getAttribute('data-block-id'))).toEqual(
      jasmine.arrayContaining(['hero', 'search', 'checkin_info', 'products']),
    );
    expect(root.querySelector('[data-testid="preview-rooms"]')?.textContent).toContain('Suite');
    expect(root.querySelector('[data-testid="pms-search"]')).toBeNull();
    expect(root.querySelector('[data-testid="preview-products"]')?.textContent).toContain('Desayuno');
  });
});
