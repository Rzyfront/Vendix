import { Component, Pipe, PipeTransform, input, provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { ServicePageHomeComponent } from './service-page-home.component';
import { ServicePagePublicConfig, ServicePageService } from './service-page.service';
import { CatalogService, EcommerceProduct } from '../../private/modules/ecommerce/services/catalog.service';
import { StoreSeoService } from '../../private/modules/ecommerce/services/store-seo';
import { CurrencyPipe } from '../../shared/pipes/currency';
import { ProductComplementsComponent } from '../product-page/components/product-complements.component';

@Pipe({ name: 'currency', standalone: true })
class StubCurrencyPipe implements PipeTransform {
  transform(value: number): string {
    return `$${value}`;
  }
}

@Component({ selector: 'app-product-complements', standalone: true, template: '{{ title() }}:{{ productIds().join(",") }}' })
class StubComplementsComponent {
  readonly productIds = input<number[]>([]);
  readonly title = input('');
  readonly compact = input(false);
}

const facial = { id: 1, name: 'Facial', slug: 'facial' };
const spa = { id: 2, name: 'Spa', slug: 'spa' };
const service = (id: number, name: string, over: Partial<EcommerceProduct> = {}) =>
  ({
    id,
    name,
    slug: `s-${id}`,
    description: '<p>Limpieza y mascarilla</p>',
    final_price: 50000,
    image_url: null,
    product_type: 'service',
    service_duration_minutes: 90,
    requires_booking: true,
    categories: [facial],
    ...over,
  }) as EcommerceProduct;

describe('ServicePageHomeComponent (apps-module Fase 3)', () => {
  let fixture: ComponentFixture<ServicePageHomeComponent>;
  let catalog: jasmine.SpyObj<CatalogService>;
  let config: ReturnType<typeof signal<ServicePagePublicConfig | null | undefined>>;
  let seo: { storeName: ReturnType<typeof signal<string>>; origin: string; apply: jasmine.Spy; release: jasmine.Spy };

  const render = async (cfg: ServicePagePublicConfig | null) => {
    config = signal<ServicePagePublicConfig | null | undefined>(cfg);
    TestBed.overrideProvider(ServicePageService, {
      useValue: { config, load: () => of(cfg) },
    });
    fixture = TestBed.createComponent(ServicePageHomeComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';

  beforeEach(() => {
    catalog = jasmine.createSpyObj('CatalogService', ['getProducts']);
    seo = {
      storeName: signal('Spa Roku'),
      origin: 'https://roku-service.vendix.online',
      apply: jasmine.createSpy('apply'),
      release: jasmine.createSpy('release'),
    };
    TestBed.configureTestingModule({
      imports: [ServicePageHomeComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: CatalogService, useValue: catalog },
        { provide: StoreSeoService, useValue: seo },
        { provide: ServicePageService, useValue: {} },
      ],
    });
    TestBed.overrideComponent(ServicePageHomeComponent, {
      remove: { imports: [CurrencyPipe, ProductComplementsComponent] },
      add: { imports: [StubCurrencyPipe, StubComplementsComponent] },
    });
  });

  it('lista los servicios en el orden de la página, con duración, precio e «Incluye»', async () => {
    catalog.getProducts.and.returnValue(
      of({ data: [service(11, 'Masaje', { categories: [spa] }), service(10, 'Limpieza facial')] } as any),
    );
    await render({ service_ids: [10, 11], featured_service_ids: [10], product_ids: [] });

    expect(catalog.getProducts).toHaveBeenCalledWith({ ids: '10,11', limit: 2 });
    const cards = Array.from(fixture.nativeElement.querySelectorAll('[data-service]')) as HTMLElement[];
    expect(cards.map((c) => c.getAttribute('data-service'))).toEqual(['s-10', 's-11']);
    expect(cards[0].textContent).toContain('Destacado');
    expect(cards[0].textContent).toContain('1 h 30 min');
    expect(cards[0].textContent).toContain('$50000');
    expect(cards[0].textContent).toContain('Incluye: Limpieza y mascarilla');
    expect(text()).toContain('Servicios de Spa Roku');
    expect(seo.apply).toHaveBeenCalledWith(
      jasmine.anything(),
      jasmine.objectContaining({ title: 'Servicios | Spa Roku', canonicalPath: '/', robots: 'index, follow' }),
    );
  });

  it('filtra por categoría', async () => {
    catalog.getProducts.and.returnValue(
      of({ data: [service(10, 'Limpieza'), service(11, 'Masaje', { categories: [spa] })] } as any),
    );
    await render({ service_ids: [10, 11], featured_service_ids: [], product_ids: [] });

    (fixture.nativeElement.querySelector('[data-category="spa"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    const cards = Array.from(fixture.nativeElement.querySelectorAll('[data-service]')) as HTMLElement[];
    expect(cards.map((c) => c.getAttribute('data-service'))).toEqual(['s-11']);
  });

  it('«Reservar» abre la reserva del ecommerce', async () => {
    catalog.getProducts.and.returnValue(of({ data: [service(10, 'Limpieza')] } as any));
    await render({ service_ids: [10], featured_service_ids: [], product_ids: [] });
    const router = TestBed.inject(Router);
    spyOn(router, 'navigate').and.resolveTo(true);

    (fixture.nativeElement.querySelector('[data-book="10"]') as HTMLButtonElement).click();

    expect(router.navigate).toHaveBeenCalledWith(['/book', 10]);
  });

  it('muestra el bloque secundario de productos debajo de los servicios', async () => {
    catalog.getProducts.and.returnValue(of({ data: [service(10, 'Limpieza')] } as any));
    await render({ service_ids: [10], featured_service_ids: [], product_ids: [7, 8] });

    const block = fixture.nativeElement.querySelector('[data-testid="service-page-products"]') as HTMLElement;
    expect(block.textContent).toContain('También puedes comprar:7,8');
  });

  it('sin página publicada dice que no está disponible', async () => {
    await render(null);

    expect(fixture.nativeElement.querySelector('[data-testid="service-page-unavailable"]')).not.toBeNull();
    expect(catalog.getProducts).not.toHaveBeenCalled();
  });
});
