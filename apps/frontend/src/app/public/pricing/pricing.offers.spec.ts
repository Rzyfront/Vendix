import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeEsCO from '@angular/common/locales/es-CO';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import {
  PricingComponent,
  PRICING_VALID_FROM,
  PRICING_VALID_FROM_LABEL,
  buildPricingJsonLd,
} from './pricing.component';
import { PublicPlan, PublicPlansService } from './services/public-plans.service';

registerLocaleData(localeEsCO, 'es-CO');

const plan = (id: number, name: string, base_price: number | string, billing_cycle: string, currency = 'COP'): PublicPlan =>
  ({ id, code: `p${id}`, name, base_price, currency, billing_cycle, features: [] }) as unknown as PublicPlan;

/** SEO-OPS-18: fecha de la oferta visible y JSON-LD con el mismo dato que el texto. */
describe('PricingComponent offers (SEO-OPS-18)', () => {
  const data = [
    plan(1, 'Emprendedor', 69900, 'monthly'),
    plan(2, 'Empresarial Pro', '969000.00', 'annual'),
    plan(3, 'Sin ciclo', 1000, 'weird'),
  ];

  it('arma una oferta por plan con el precio, la moneda y la vigencia de la API', () => {
    const ld = buildPricingJsonLd(data) as { offers: Array<Record<string, string>> };
    expect(ld.offers.length).toBe(2);
    expect(ld.offers[0]).toEqual(jasmine.objectContaining({
      name: 'Emprendedor · Mensual', price: '69900', priceCurrency: 'COP', validFrom: PRICING_VALID_FROM,
    }));
    expect(ld.offers[1]).toEqual(jasmine.objectContaining({ name: 'Empresarial Pro · Anual', price: '969000' }));
  });

  it('sin planes no publica JSON-LD', () => {
    expect(buildPricingJsonLd([])).toBeNull();
  });

  describe('en la página', () => {
    let fixture: ComponentFixture<PricingComponent>;
    beforeEach(async () => {
      await TestBed.configureTestingModule({
        imports: [PricingComponent],
        providers: [
          provideZonelessChangeDetection(),
          provideRouter([{ path: '**', children: [] }]),
          { provide: PublicPlansService, useValue: { list$: of({ success: true, data }) } },
        ],
      }).compileComponents();
      fixture = TestBed.createComponent(PricingComponent);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    });

    it('muestra desde cuándo rigen los precios', () => {
      const terms = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="pricing-terms"]');
      expect(terms?.textContent).toContain(PRICING_VALID_FROM_LABEL);
    });

    it('pone en el head un solo JSON-LD y lo quita al salir', () => {
      const scripts = document.head.querySelectorAll('#vendix-pricing-offers');
      expect(scripts.length).toBe(1);
      const ld = JSON.parse(scripts[0].textContent || '{}');
      expect(ld['@type']).toBe('Product');
      expect(ld.offers.length).toBe(2);
      fixture.destroy();
      expect(document.head.querySelector('#vendix-pricing-offers')).toBeNull();
    });
  });
});
