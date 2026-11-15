import { TestBed } from '@angular/core/testing';
import { PosCashMovementModalComponent } from './pos-cash-movement-modal.component';
import { PosCashRegisterService } from '../services/pos-cash-register.service';
import { ToastService } from '../../../../../shared/components/toast/toast.service';

/** Hallazgo demo 11-nov (T5): la salida sin notas recibía un 400 genérico del backend. */
describe('PosCashMovementModalComponent — notas en salidas', () => {
  let component: PosCashMovementModalComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PosCashMovementModalComponent],
      providers: [
        { provide: PosCashRegisterService, useValue: {} },
        { provide: ToastService, useValue: { success() {}, error() {} } },
      ],
    })
      .overrideComponent(PosCashMovementModalComponent, { set: { template: '' } })
      .compileComponents();

    component = TestBed.createComponent(PosCashMovementModalComponent).componentInstance;
  });

  it('una entrada sin notas es válida', () => {
    component.form.patchValue({ type: 'cash_in', amount: 1000, notes: '' });
    expect(component.form.valid).toBeTrue();
  });

  it('una salida exige un motivo y no acepta solo espacios', () => {
    component.form.patchValue({ type: 'cash_out', amount: 1000, notes: '   ' });
    expect(component.form.valid).toBeFalse();
    component.form.get('notes')!.markAsTouched();
    expect(component.getFieldError('notes')).toBe('Escribe el motivo de la salida');

    component.form.patchValue({ notes: 'Pago a proveedor de hielo' });
    expect(component.form.valid).toBeTrue();
  });

  it('al volver a entrada la nota deja de ser obligatoria', () => {
    component.form.patchValue({ type: 'cash_out', amount: 1000, notes: '' });
    expect(component.form.valid).toBeFalse();
    component.form.patchValue({ type: 'cash_in' });
    expect(component.form.valid).toBeTrue();
  });
});
