import { ComponentFixture, TestBed } from '@angular/core/testing';

import { InvoiceLineTaxesComponent } from './invoice-line-taxes.component';
import type { TaxSelection } from '../../../../../../shared/components/tax-selector';

/**
 * Paso 2 del plan AIU — constancia neutra del costo reembolsable.
 *
 * La propiedad custodiada: una línea AIU sin componente suma al valor del
 * contrato y queda fuera de la base gravable, así que salir sin impuesto NO
 * afirma una operación excluida ni exenta. Con `aiuCostLine` el aviso y su
 * mensaje espejo (`triggerHint`) dicen la constancia neutra; sin él, la copia
 * histórica no cambia ni una coma.
 */
describe('InvoiceLineTaxesComponent · aiuCostLine (paso 2 AIU)', () => {
  let fixture: ComponentFixture<InvoiceLineTaxesComponent>;
  let component: InvoiceLineTaxesComponent;

  const NEUTRAL = 'Costo reembolsable — fuera de la base gravable AIU.';

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

  it('sin aiuCostLine la línea vacía advierte operación excluida o exenta (histórico intacto)', () => {
    fixture.detectChanges();
    expect(paragraphText()).toContain('excluida o exenta');
    expect(paragraphText()).not.toContain('Costo reembolsable');
    expect(component.triggerHint()).toContain('excluida o exenta');
  });

  it('con aiuCostLine la línea vacía deja la constancia neutra en el párrafo y en el espejo', () => {
    fixture.componentRef.setInput('aiuCostLine', true);
    fixture.detectChanges();
    expect(paragraphText()).toContain(NEUTRAL);
    expect(paragraphText()).not.toContain('excluida o exenta');
    expect(paragraphText()).not.toContain('sub-declara');
    expect(component.triggerHint()).toBe(NEUTRAL);
  });

  it('con aiuCostLine pero CON impuestos no hay párrafo: la línea ya declara', () => {
    const taxes: TaxSelection[] = [
      {
        tax_rate_id: 1,
        rate: 19,
        name: 'IVA 19 %',
        tax_type: 'iva',
        is_inclusive: false,
      },
    ];
    fixture.componentRef.setInput('aiuCostLine', true);
    component.writeValue(taxes);
    fixture.detectChanges();
    expect(paragraphText()).toBe('');
    expect(component.triggerHint()).toContain('Agregar otro impuesto');
  });

  it('quitar el último impuesto con aiuCostLine vuelve a la constancia, no al aviso', () => {
    fixture.componentRef.setInput('aiuCostLine', true);
    component.writeValue([
      {
        tax_rate_id: 1,
        rate: 19,
        name: 'IVA 19 %',
        tax_type: 'iva',
        is_inclusive: false,
      },
    ]);
    fixture.detectChanges();
    component.remove(1);
    fixture.detectChanges();
    expect(paragraphText()).toContain(NEUTRAL);
    expect(component.triggerHint()).toBe(NEUTRAL);
  });
});
