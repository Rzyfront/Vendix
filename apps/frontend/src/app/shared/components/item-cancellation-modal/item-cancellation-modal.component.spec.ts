import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ItemCancellationModalComponent, ItemCancellationSubmit } from './item-cancellation-modal.component';

describe('ItemCancellationModalComponent — reusar por defecto', () => {
  let fixture: ComponentFixture<ItemCancellationModalComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ItemCancellationModalComponent],
      providers: [provideZonelessChangeDetection()],
    }).overrideComponent(ItemCancellationModalComponent, {
      set: { template: '', imports: [] },
    }).compileComponents();
    fixture = TestBed.createComponent(ItemCancellationModalComponent);
  });

  afterEach(() => fixture.destroy());

  function open(canReuse = true): ItemCancellationModalComponent {
    fixture.componentRef.setInput('canReuse', canReuse);
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  it('preselecciona reusar y lo envía para cancelar o reversar un plato', () => {
    const component = open();
    expect(component.destination()).toBe('reuse');
    component.reason.set('Plato aprovechable');
    const emitted: ItemCancellationSubmit[] = [];
    component.confirmed.subscribe((value) => emitted.push(value));
    component.onConfirm();
    expect(emitted).toEqual([{ reason: 'Plato aprovechable', destination: 'reuse' }]);
  });

  it('respeta desechar cuando el usuario lo elige durante la apertura actual', () => {
    const component = open();
    component.destination.set('waste');
    component.reason.set('Plato contaminado');
    fixture.componentRef.setInput('itemName', 'Plato actualizado');
    fixture.detectChanges();
    const emitted: ItemCancellationSubmit[] = [];
    component.confirmed.subscribe((value) => emitted.push(value));
    component.onConfirm();
    expect(emitted[0].destination).toBe('waste');
  });

  it('vuelve a reusar al reabrir, sin arrastrar la merma del plato anterior', () => {
    const component = open();
    component.destination.set('waste');
    component.reason.set('Motivo anterior');
    component.close();
    fixture.componentRef.setInput('isOpen', false);
    fixture.detectChanges();
    open();
    expect(component.destination()).toBe('reuse');
    expect(component.reason()).toBe('');
  });

  it('no preselecciona una disposición deshabilitada cuando no hay insumos reutilizables', () => {
    expect(open(false).destination()).toBe('waste');
  });

  it('la preselección no permite confirmar sin motivo ni durante una operación', () => {
    const component = open();
    const emitted: ItemCancellationSubmit[] = [];
    component.confirmed.subscribe((value) => emitted.push(value));
    component.onConfirm();
    expect(emitted).toHaveSize(0);
    component.reason.set('Motivo válido');
    fixture.componentRef.setInput('inFlight', true);
    fixture.detectChanges();
    component.onConfirm();
    component.close();
    expect(emitted).toHaveSize(0);
    expect(component.isOpen()).toBeTrue();
  });
});
