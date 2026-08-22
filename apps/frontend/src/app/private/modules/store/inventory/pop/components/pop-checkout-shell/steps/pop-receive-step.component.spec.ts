import { ComponentFixture, TestBed } from '@angular/core/testing';

import { InputComponent } from '../../../../../../../../shared/components/input/input.component';
import { CurrencyFormatService } from '../../../../../../../../shared/pipes/currency/currency.pipe';
import { PopReceiveStepComponent } from './pop-receive-step.component';
import { PopCostPreviewItem } from '../../../interfaces';

type FormatStyle = 'comma_dot' | 'dot_comma' | 'space_comma';

/**
 * Stub de moneda con `format_style` intercambiable: es EL eje del defecto.
 * `comma_dot` agrupa con coma (`1,500,000`) y `dot_comma` con punto
 * (`1.500.000`); los dos rompían el consumo y por eso los dos se ejercen.
 */
const buildCurrencyStub = (style: FormatStyle) =>
  ({
    currencyFormatStyle: () => style,
    currencyDecimals: () => 0,
    currencySymbol: () => '$',
    currencyPosition: () => 'before',
    currentCurrency: () => ({ format_style: style, decimal_places: 0 }),
    format: (n: number | string | null | undefined) => String(n ?? 0),
    loadCurrency: () => undefined,
  }) as unknown as CurrencyFormatService;

const buildPreviewItem = (): PopCostPreviewItem =>
  ({
    product_id: 7,
    product_variant_id: null,
    product_name: 'Producto',
    current_stock: 10,
    current_cost_per_unit: 900,
    global_stock: 10,
    global_cost_per_unit: 900,
    new_stock: 20,
    new_cost_per_unit: 1000,
    incoming_quantity: 10,
    incoming_cost: 10000,
    current_base_price: 1200,
    current_profit_margin: 20,
    resulting_margin: 20,
    is_reactivation: false,
  }) as unknown as PopCostPreviewItem;

/**
 * A.14 — regresión medida: teclear un precio base >= 1000 BORRABA el override
 * en silencio.
 *
 * `app-input [currency]` emitía por `inputChange` el texto YA FORMATEADO. El
 * paso de recepción lo pasaba por `Number(...)`, que sobre `"1,500,000"` o
 * `"1.500.000"` da `NaN`, y `NaN` caía en la rama «vacío» que limpia el
 * override. El operador escribía un precio y el sistema se quedaba con el
 * anterior sin decir nada.
 *
 * La suite ataca los dos extremos del contrato:
 *  (1) el EMISOR entrega el número canónico en los dos estilos de formato;
 *  (2) el CONSUMIDOR conserva el override con ese payload.
 */
describe('A.14 — dinero tecleado en el paso de recepción', () => {
  function typeCurrency(style: FormatStyle, typed: string): string {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [InputComponent],
      providers: [
        { provide: CurrencyFormatService, useFactory: () => buildCurrencyStub(style) },
      ],
    });
    const fixture: ComponentFixture<InputComponent> =
      TestBed.createComponent(InputComponent);
    fixture.componentRef.setInput('currency', true);
    fixture.detectChanges();

    let emitted = '';
    fixture.componentInstance.inputChange.subscribe((v: string) => (emitted = v));

    const input: HTMLInputElement =
      fixture.nativeElement.querySelector('input');
    input.value = typed;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    return emitted;
  }

  it('(a) comma_dot: el payload es el número, no "1,500,000"', () => {
    const emitted = typeCurrency('comma_dot', '1500000');
    expect(Number(emitted)).toBe(1500000);
    expect(emitted).not.toContain(',');
  });

  it('(b) dot_comma: el payload es el número, no "1.500.000"', () => {
    const emitted = typeCurrency('dot_comma', '1500000');
    expect(Number(emitted)).toBe(1500000);
    // Un punto de miles convertiría "1.500.000" en NaN al parsear.
    expect(Number.isNaN(Number(emitted))).toBe(false);
  });

  it('(c) el campo vacío emite "" (que sí debe limpiar el override)', () => {
    expect(typeCurrency('comma_dot', '')).toBe('');
  });

  it('(d) el paso de recepción conserva el override con un precio >= 1000', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [PopReceiveStepComponent],
      providers: [
        {
          provide: CurrencyFormatService,
          useFactory: () => buildCurrencyStub('dot_comma'),
        },
      ],
    });
    const fixture = TestBed.createComponent(PopReceiveStepComponent);
    const component = fixture.componentInstance;
    const item = buildPreviewItem();
    fixture.componentRef.setInput('costPreview', {
      costing_method: 'cpp',
      items: [item],
    });
    fixture.detectChanges();

    component.onPriceDraftChange(item, '1500000');

    expect(component.hasOverride(item)).toBe(true);
    expect(component.priceDraftFor(item)).toBe('1500000');
  });

  it('(e) el texto formateado que emitía el bug seguiría borrando el override', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [PopReceiveStepComponent],
      providers: [
        {
          provide: CurrencyFormatService,
          useFactory: () => buildCurrencyStub('comma_dot'),
        },
      ],
    });
    const fixture = TestBed.createComponent(PopReceiveStepComponent);
    const component = fixture.componentInstance;
    const item = buildPreviewItem();
    fixture.componentRef.setInput('costPreview', {
      costing_method: 'cpp',
      items: [item],
    });
    fixture.detectChanges();

    // Deja constancia de POR QUÉ el emisor tuvo que cambiar: con el texto
    // agrupado el consumidor no tiene forma de recuperar el número.
    component.onPriceDraftChange(item, '1,500,000');
    expect(component.hasOverride(item)).toBe(false);
  });
});
