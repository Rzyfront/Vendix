import { CUSTOM_ELEMENTS_SCHEMA, provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { LandingOfferComponent } from './landing-offer.component';
import { LandingOffer } from './landing-page.service';
import { CatalogService } from '../../private/modules/ecommerce/services/catalog.service';
import { ProductCardComponent } from '../../private/modules/ecommerce/components/product-card/product-card.component';
import { ProductQuickViewModalComponent } from '../../private/modules/ecommerce/components/product-quick-view-modal';

describe('LandingOfferComponent (apps-module Fase 6)', () => {
  let fixture: ComponentFixture<LandingOfferComponent>;
  let catalog: jasmine.SpyObj<CatalogService>;

  const render = async (offer: LandingOffer) => {
    fixture = TestBed.createComponent(LandingOfferComponent);
    fixture.componentRef.setInput('offer', offer);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const el = (id: string): HTMLElement | null =>
    fixture.nativeElement.querySelector(`[data-testid="${id}"]`);

  beforeEach(() => {
    catalog = jasmine.createSpyObj('CatalogService', ['getProducts']);
    catalog.getProducts.and.returnValue(
      of({ data: [{ id: 7, slug: 'combo', name: 'Combo familiar' }] } as any),
    );
    TestBed.configureTestingModule({
      imports: [LandingOfferComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: CatalogService, useValue: catalog },
      ],
    });
    // Card and quick view are the ecommerce components; their own specs cover them.
    TestBed.overrideComponent(LandingOfferComponent, {
      remove: { imports: [ProductCardComponent, ProductQuickViewModalComponent] },
      add: { schemas: [CUSTOM_ELEMENTS_SCHEMA] },
    });
  });

  it('la oferta informativa invita a dejar los datos', async () => {
    await render({ mode: 'info', title: 'Asesoría gratis', description: 'Te llamamos hoy', product: null });
    let interested = 0;
    fixture.componentInstance.interested.subscribe(() => interested++);

    expect(fixture.nativeElement.textContent).toContain('Asesoría gratis');
    expect(fixture.nativeElement.textContent).toContain('Te llamamos hoy');
    expect(el('landing-offer-buy')).toBeNull();
    el('landing-offer-cta')!.click();
    expect(interested).toBe(1);
    expect(catalog.getProducts).not.toHaveBeenCalled();
  });

  it('la oferta con producto lleva a comprarlo en este dominio', async () => {
    await render({
      mode: 'product',
      title: 'Combo de lanzamiento',
      description: null,
      product: { id: 7, slug: 'combo', name: 'Combo familiar' },
    });

    expect(catalog.getProducts).toHaveBeenCalledWith({ ids: '7', limit: 1 });
    expect(el('landing-offer-buy')!.getAttribute('href')).toBe('/products/combo');
    expect(el('landing-offer-cta')).toBeNull();
  });

  it('un producto que ya no se vende deja sólo el título', async () => {
    catalog.getProducts.and.returnValue(of({ data: [] } as any));
    await render({
      mode: 'product',
      title: 'Combo de lanzamiento',
      description: null,
      product: { id: 7, slug: 'combo', name: 'Combo familiar' },
    });

    expect(fixture.nativeElement.textContent).toContain('Combo de lanzamiento');
    expect(el('landing-offer-buy')).toBeNull();
  });
});
