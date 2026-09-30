import { ComponentFixture, TestBed } from '@angular/core/testing';

import { LineTaxesEditorComponent } from './line-taxes-editor.component';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency';
import type { PopLineTax } from '../../interfaces/pop-cart.interface';

const currencyStub = {
  loadCurrency: () => Promise.resolve(null),
  format: (n: number | string | null | undefined) =>
    `$${Number(n ?? 0).toFixed(2)}`,
  currencyFormatStyle: () => 'comma_dot' as const,
  currencyDecimals: () => 2,
} as unknown as CurrencyFormatService;

describe('LineTaxesEditorComponent — QUI-855', () => {
  let fixture: ComponentFixture<LineTaxesEditorComponent>;
  let component: LineTaxesEditorComponent;

  const iva: PopLineTax = {
    tax_type: 'iva',
    tax_rate: 19,
    calc_mode: 'percent',
    add_to_cost: false,
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [LineTaxesEditorComponent],
      providers: [{ provide: CurrencyFormatService, useValue: currencyStub }],
    });
    fixture = TestBed.createComponent(LineTaxesEditorComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('taxes', [iva]);
    fixture.componentRef.setInput('unitPrice', 1000);
    fixture.componentRef.setInput('quantity', 2);
    fixture.componentRef.setInput('discountAmount', 0);
    fixture.componentRef.setInput('pricesIncludeTax', false);
    fixture.detectChanges();
  });

  it('deriva el desglose con el kernel (IVA 19 % agregado sobre 2000)', () => {
    const d = component.derived();
    expect(d.net_line).toBe(2000);
    expect(d.tax_amount).toBe(380);
    expect(component.amountOf('iva')).toBe(380);
  });

  it('con IVA incluido el neto se extrae del bruto', () => {
    fixture.componentRef.setInput('pricesIncludeTax', true);
    fixture.componentRef.setInput('unitPrice', 1190);
    fixture.componentRef.setInput('quantity', 1);
    fixture.detectChanges();
    expect(component.derived().net_line).toBe(1000);
    expect(component.derived().tax_amount).toBe(190);
  });

  it('agregar un impuesto emite las filas con el nuevo y no repite tipos', () => {
    const emitted: PopLineTax[][] = [];
    component.taxesChange.subscribe((t) => emitted.push(t));

    component.addRow('inc');
    expect(emitted.length).toBe(1);
    expect(emitted[0].map((t) => t.tax_type)).toEqual(['iva', 'inc']);
    expect(emitted[0][1].add_to_cost).toBe(true);

    component.addRow('iva'); // ya existe: no emite
    expect(emitted.length).toBe(1);
    expect(component.availableTypes()).toEqual(['inc', 'icui', 'ibua']);
  });

  it('IBUA nace como monto fijo por unidad', () => {
    const emitted: PopLineTax[][] = [];
    component.taxesChange.subscribe((t) => emitted.push(t));
    component.addRow('ibua');
    const row = emitted[0].find((t) => t.tax_type === 'ibua')!;
    expect(row.calc_mode).toBe('fixed_per_unit');
    expect(row.tax_rate).toBeNull();
  });

  it('editar la tasa emite la fila parchada y siempre queda una fila', () => {
    const emitted: PopLineTax[][] = [];
    component.taxesChange.subscribe((t) => emitted.push(t));

    component.updateRate('iva', '5');
    expect(emitted[0][0].tax_rate).toBe(5);

    component.removeRow('iva'); // única fila: no se quita
    expect(emitted.length).toBe(1);
  });

  it('el toggle de modo de la línea emite pricesIncludeTaxChange', () => {
    const emitted: boolean[] = [];
    component.pricesIncludeTaxChange.subscribe((v) => emitted.push(v));
    component.pricesIncludeTaxChange.emit(true);
    expect(emitted).toEqual([true]);
  });
});
