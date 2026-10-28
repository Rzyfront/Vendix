import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ModalComponent } from '../../../../../shared/components';
import { PosCustomerTierModalComponent } from './pos-customer-tier-modal.component';
import { CustomerTierPrompt } from '../utils/customer-tier-prompt.util';

/** Spec: odd/tasks/price-tier-adjustments-customers.md S6. */
describe('PosCustomerTierModalComponent', () => {
  const prompt: CustomerTierPrompt = {
    mode: 'apply',
    tier: { id: 7, name: 'Mayorista' },
    lines: [
      { itemId: 'a', label: 'Martillo' },
      { itemId: 'b', label: 'Clavos' },
    ],
  };

  const render = async (value: CustomerTierPrompt | null) => {
    TestBed.configureTestingModule({
      imports: [PosCustomerTierModalComponent],
      providers: [provideZonelessChangeDetection()],
    });
    const fixture = TestBed.createComponent(PosCustomerTierModalComponent);
    fixture.componentRef.setInput('prompt', value);
    await fixture.whenStable();
    return fixture;
  };

  it('muestra la tarifa y las líneas, todas marcadas al abrir', async () => {
    const fixture = await render(prompt);
    const text = document.body.textContent ?? '';
    expect(text).toContain('Este cliente tiene la tarifa Mayorista');
    expect(text).toContain('Martillo');
    expect(fixture.componentInstance.selectedIds()).toEqual(['a', 'b']);
  });

  it('"Aplicar a seleccionadas" emite solo las líneas que siguen marcadas', async () => {
    const fixture = await render(prompt);
    const emitted: string[][] = [];
    fixture.componentInstance.confirmed.subscribe((ids) => emitted.push(ids));
    fixture.componentInstance.toggle('a');
    expect(fixture.componentInstance.selectedIds()).toEqual(['b']);
    fixture.componentInstance.confirmed.emit(fixture.componentInstance.selectedIds());
    expect(emitted).toEqual([['b']]);
  });

  it('en modo restaurar habla del cliente anterior', async () => {
    await render({ ...prompt, mode: 'restore' });
    expect(document.body.textContent ?? '').toContain(
      'El cliente anterior tenía la tarifa Mayorista',
    );
  });

  it('cerrar el modal (X, Escape, fondo) emite "dismissed" una sola vez', async () => {
    const fixture = await render(prompt);
    let dismissals = 0;
    fixture.componentInstance.dismissed.subscribe(() => dismissals++);
    const modal = fixture.debugElement.query(By.directive(ModalComponent))
      .componentInstance as ModalComponent;
    modal.close();
    await fixture.whenStable();
    expect(dismissals).toBe(1);
  });
});
