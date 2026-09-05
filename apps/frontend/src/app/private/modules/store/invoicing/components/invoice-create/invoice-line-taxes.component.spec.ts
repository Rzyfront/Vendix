import { ComponentFixture, TestBed } from '@angular/core/testing';

import { InvoiceLineTaxesComponent } from './invoice-line-taxes.component';
import { resolveAiuLineComponent } from '../../../../../../shared/components/invoice-sections/invoice-section-lineas.component';
import type { TaxSelection } from '../../../../../../shared/components/tax-selector';
import type { AiuTaxableBasis } from '../../../../../../core/utils/invoice-profile-config.contract';

/**
 * Paso 9 del plan AIU — el aviso de sub-declaración deja de acusar a las
 * porciones que la base declarada NO grava.
 *
 * La propiedad custodiada: una línea sin impuesto sólo sub-declara si su
 * porción entra a la base gravable vigente. Bajo base `'utilidad'`,
 * Administración e Imprevistos están correctamente sin impuesto, y acusarlas
 * entrena al operador a ignorar el aviso — que existe precisamente para el
 * caso en que sí importa (una Utilidad que se quedó sin IVA).
 *
 * El predicado ya no es «¿lleva componente?» sino «¿su porción grava bajo la
 * base declarada?», y quien lo responde es `isAiuLineTaxable` sobre
 * `AIU_TAXABLE_BUCKETS_BY_BASIS` — la misma tabla que usa el backend, así que
 * el aviso de la pantalla no puede divergir de la base que se declara ante la
 * DIAN.
 */
describe('InvoiceLineTaxesComponent · aviso AIU por porción y base (paso 9)', () => {
  let fixture: ComponentFixture<InvoiceLineTaxesComponent>;
  let component: InvoiceLineTaxesComponent;

  const COSTO = 'Costo reembolsable — fuera de la base gravable AIU.';
  const ADMINISTRACION = 'Administración — fuera de la base gravable AIU.';
  const IMPREVISTOS = 'Imprevistos — fuera de la base gravable AIU.';
  const SUBDECLARA = 'sub-declara impuesto';

  const IVA_19: TaxSelection = {
    tax_rate_id: 1,
    rate: 19,
    name: 'IVA 19 %',
    tax_type: 'iva',
    is_inclusive: false,
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InvoiceLineTaxesComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(InvoiceLineTaxesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  const paragraphText = (): string =>
    (fixture.nativeElement as HTMLElement).querySelector('p')?.textContent ??
    '';

  /**
   * Pinta la línea tal como la arma `vendix-invoice-section-lineas`: la
   * porción sale del valor CRUDO del control de la fila y la base, del
   * documento. Pasar por `resolveAiuLineComponent` es deliberado — es la
   * mitad del camino que vive en la sección compartida, y probarla acá impide
   * que las dos mitades se separen.
   */
  const renderLine = (
    rawAiuControlValue: unknown,
    basis: AiuTaxableBasis | null,
  ): void => {
    fixture.componentRef.setInput(
      'aiuLineComponent',
      resolveAiuLineComponent(rawAiuControlValue),
    );
    fixture.componentRef.setInput('aiuTaxableBasis', basis);
    fixture.detectChanges();
  };

  // ── Base 'utilidad': el caso que reportó el dueño ─────────────

  it('base utilidad · Administración sin impuesto NO es sub-declaración, y el aviso la nombra', () => {
    renderLine('administracion', 'utilidad');
    expect(paragraphText()).toContain(ADMINISTRACION);
    expect(paragraphText()).not.toContain(SUBDECLARA);
    expect(paragraphText()).not.toContain('excluida o exenta');
    expect(component.triggerHint()).toBe(ADMINISTRACION);
  });

  it('base utilidad · Imprevistos sin impuesto NO es sub-declaración, y el aviso lo nombra', () => {
    renderLine('imprevistos', 'utilidad');
    expect(paragraphText()).toContain(IMPREVISTOS);
    expect(paragraphText()).not.toContain(SUBDECLARA);
    expect(component.triggerHint()).toBe(IMPREVISTOS);
  });

  it('base utilidad · Utilidad sin impuesto SÍ sigue acusando sub-declaración', () => {
    renderLine('utilidad', 'utilidad');
    expect(paragraphText()).toContain(SUBDECLARA);
    expect(paragraphText()).toContain('excluida o exenta');
    expect(paragraphText()).not.toContain('fuera de la base gravable AIU');
    expect(component.triggerHint()).toContain('excluida o exenta');
  });

  it('base utilidad · el costo reembolsable conserva su constancia de siempre', () => {
    renderLine('', 'utilidad');
    expect(paragraphText()).toContain(COSTO);
    expect(paragraphText()).not.toContain(SUBDECLARA);
  });

  // ── Base 'aiu': las tres porciones gravan, ninguna se salva ────

  it('base aiu · Administración sin impuesto SÍ sub-declara: bajo esa base sí grava', () => {
    renderLine('administracion', 'aiu');
    expect(paragraphText()).toContain(SUBDECLARA);
    expect(paragraphText()).not.toContain('fuera de la base gravable AIU');
  });

  it('base aiu · el costo reembolsable queda fuera y deja la constancia neutra', () => {
    renderLine('', 'aiu');
    expect(paragraphText()).toContain(COSTO);
    expect(paragraphText()).not.toContain(SUBDECLARA);
    expect(component.triggerHint()).toBe(COSTO);
  });

  // ── Base 'subtotal': declina el tratamiento AIU, grava todo ────

  it('base subtotal · hasta el costo reembolsable sub-declara: esa base grava el contrato entero', () => {
    renderLine('', 'subtotal');
    expect(paragraphText()).toContain(SUBDECLARA);
    expect(paragraphText()).not.toContain('Costo reembolsable');
  });

  // ── Modelo 1: la línea que vale el contrato ────────────────────

  it('componente contrato · nunca queda fuera de base: contiene alguna porción gravable', () => {
    renderLine('contrato', 'utilidad');
    expect(paragraphText()).toContain(SUBDECLARA);
    expect(paragraphText()).not.toContain('fuera de la base gravable AIU');
  });

  // ── Regresión: la factura que no es AIU no cambia ni una coma ──

  it('sin base AIU la línea vacía advierte operación excluida o exenta (histórico intacto)', () => {
    renderLine('', null);
    expect(paragraphText()).toContain('excluida o exenta');
    expect(paragraphText()).not.toContain('fuera de la base gravable AIU');
    expect(component.triggerHint()).toContain('excluida o exenta');
  });

  it('sin base AIU un componente suelto tampoco produce constancia neutra', () => {
    renderLine('administracion', null);
    expect(paragraphText()).toContain(SUBDECLARA);
    expect(paragraphText()).not.toContain('fuera de la base gravable AIU');
  });

  // ── La línea que SÍ declara impuesto no discute nada ───────────

  it('con impuestos declarados no hay párrafo, aunque la porción esté fuera de base', () => {
    renderLine('administracion', 'utilidad');
    component.writeValue([IVA_19]);
    fixture.detectChanges();
    expect(paragraphText()).toBe('');
    expect(component.triggerHint()).toContain('Agregar otro impuesto');
  });

  it('quitar el último impuesto vuelve a la constancia nombrada, no al aviso', () => {
    renderLine('administracion', 'utilidad');
    component.writeValue([IVA_19]);
    fixture.detectChanges();
    component.remove(IVA_19.tax_rate_id);
    fixture.detectChanges();
    expect(paragraphText()).toContain(ADMINISTRACION);
    expect(component.triggerHint()).toBe(ADMINISTRACION);
  });

  // ── La mitad del predicado que vive en la sección compartida ───

  it('resolveAiuLineComponent traduce el control crudo y descarta lo que no es porción', () => {
    expect(resolveAiuLineComponent('administracion')).toBe('administracion');
    expect(resolveAiuLineComponent('imprevistos')).toBe('imprevistos');
    expect(resolveAiuLineComponent('utilidad')).toBe('utilidad');
    expect(resolveAiuLineComponent('contrato')).toBe('contrato');
    // Vacío, nulo y el 'costo' con que el perfil codifica «apagado» son la
    // AUSENCIA de componente, no un componente: todos caen al bucket costo.
    expect(resolveAiuLineComponent('')).toBeNull();
    expect(resolveAiuLineComponent(null)).toBeNull();
    expect(resolveAiuLineComponent(undefined)).toBeNull();
    expect(resolveAiuLineComponent('costo')).toBeNull();
  });
});
