import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';

import { StopSettleModalComponent } from './stop-settle-modal.component';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import { SettleStopDto } from '../../interfaces/planilla.interface';

/**
 * Liquidación MANUAL de una parada: una orden prepagada no pregunta si se
 * cobró ni deja cobrarla (sin campo de recaudo; envía 0 con método 'prepaid').
 */
describe('StopSettleModalComponent — parada prepagada', () => {
  let fixture: ComponentFixture<StopSettleModalComponent>;
  let component: StopSettleModalComponent;

  const stop = {
    id: 55,
    stop_sequence: 1,
    status: 'pending',
    is_prepaid: true,
    dispatch_note: { dispatch_number: 'REM-1', customer_name: 'Cliente' },
  } as any;

  const create = (isPrepaid: boolean, pendingAmount: number | null) => {
    TestBed.configureTestingModule({
      imports: [StopSettleModalComponent],
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: CurrencyFormatService,
          useValue: { loadCurrency: () => undefined, format: (v: number) => `$${v}` },
        },
      ],
    });
    fixture = TestBed.createComponent(StopSettleModalComponent);
    fixture.componentRef.setInput('stop', stop);
    fixture.componentRef.setInput('grandTotal', 200);
    fixture.componentRef.setInput('isPrepaid', isPrepaid);
    fixture.componentRef.setInput('pendingAmount', pendingAmount);
    component = fixture.componentInstance;
    component.ngOnInit();
  };

  const submitAndCapture = (): SettleStopDto => {
    let dto: SettleStopDto | undefined;
    component.submitted.subscribe((d) => (dto = d));
    component.submit();
    expect(dto).toBeDefined();
    return dto!;
  };

  it('prepagada: entrega sin cobro aunque se intente digitar un monto', () => {
    create(true, 0);

    expect(component.isPaid()).toBeTrue();
    expect(component.canConfirm()).toBeTrue();
    component.collectedAmount = 200; // intento de cobro: se descarta

    const dto = submitAndCapture();
    expect(dto).toEqual(
      jasmine.objectContaining({
        result: 'delivered',
        collected_amount: 0,
        payment_method: 'prepaid',
      }),
    );
    expect(dto.withholding_amount).toBeUndefined();
  });

  it('prepagada: el modal no muestra el campo de recaudo', async () => {
    create(true, 0);
    fixture.detectChanges();
    await fixture.whenStable();

    const text = (document.body.textContent || '') + (fixture.nativeElement.textContent || '');
    expect(text).toContain('Pagada');
    expect(text).not.toContain('Recaudado (efectivo)');
  });

  it('contra entrega: sí pide el cobro (control)', () => {
    create(false, 200);

    expect(component.isPaid()).toBeFalse();
    expect(component.collectedAmount).toBe(200);
  });
});
