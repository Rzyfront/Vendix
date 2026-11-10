import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeEsCO from '@angular/common/locales/es-CO';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { PricingComponent, normalizePricingCycle } from './pricing.component';
import { PublicPlan, PublicPlansService } from './services/public-plans.service';

registerLocaleData(localeEsCO, 'es-CO');

const plan = (id: number, name: string, base_price: number, billing_cycle: string): PublicPlan =>
  ({ id, code: `p${id}`, name, base_price, currency: 'COP', billing_cycle, features: [] }) as unknown as PublicPlan;

/** SEO-OPS-18: los planes se muestran por ciclo de cobro, no mezclados. */
describe('PricingComponent billing cycles (SEO-OPS-18)', () => {
  let fixture: ComponentFixture<PricingComponent>;
  const data = [
    plan(1, 'Emprendedor', 69900, 'monthly'),
    plan(2, 'Empresarial Pro', 89900, 'monthly'),
    plan(3, 'Emprendedor', 199000, 'quarterly'),
    plan(4, 'Empresarial Pro', 969000, 'annual'),
  ];

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
    fixture.componentInstance.setViewMode('cards');
    fixture.detectChanges();
    await fixture.whenStable();
  });

  afterEach(() => fixture.destroy());

  it('muestra solo los planes mensuales al entrar y ofrece los tres ciclos', () => {
    const c = fixture.componentInstance;
    expect(c.visiblePlans().map((p) => p.id)).toEqual([1, 2]);
    const tabs = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('[aria-label="Ciclo de cobro"] button'),
    ).map((b) => b.textContent?.trim());
    expect(tabs).toEqual(['Mensual', 'Trimestral', 'Anual']);
  });

  it('al elegir Anual cambia la lista y los precios salen en formato colombiano', async () => {
    fixture.componentInstance.setCycle('annual');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.visiblePlans().map((p) => p.id)).toEqual([4]);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('969.000');
    expect(text).not.toContain('COP969,000');
  });

  it('dice la moneda y la prueba sin tarjeta', () => {
    const terms = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="pricing-terms"]');
    expect(terms?.textContent).toContain('pesos colombianos (COP)');
    expect(terms?.textContent).toContain('14 días sin tarjeta');
  });

  it('normaliza yearly como anual y deja fuera ciclos desconocidos', () => {
    expect(normalizePricingCycle('yearly')).toBe('annual');
    expect(normalizePricingCycle('lifetime')).toBeNull();
  });

  it('explica permanencia, IVA, certificado digital y comisiones de Wompi sin prometer de más', () => {
    const box = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="pricing-conditions"]');
    const text = box?.textContent ?? '';
    expect(text).toContain('Sin permanencia');
    expect(text).toContain('no se reembolsa');
    expect(text).toContain('artículo 476');
    expect(text).toContain('Empresarial Pro e IA Business con pago anual');
    expect(text).toContain('directamente a Wompi');
    expect(box?.querySelector('a[href="/legal/terminos"]')).not.toBeNull();
  });
});
