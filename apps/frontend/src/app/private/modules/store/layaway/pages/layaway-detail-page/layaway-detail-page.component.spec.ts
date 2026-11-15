import { provideZonelessChangeDetection } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { of, throwError } from 'rxjs';
import { LayawayDetailPageComponent } from './layaway-detail-page.component';
import { LayawayApiService } from '../../services/layaway.service';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { PaymentMethodsService } from '../../../settings/payments/services/payment-methods.service';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import type { LayawayPlan } from '../../interfaces/layaway.interface';

/**
 * QUI-893 — a cancellation the backend blocks (no open cash session, missing
 * refund method, plan already cancelled) must never read as success: the
 * modal stays open with the real reason and no green "Plan cancelado" toast.
 */
describe('LayawayDetailPageComponent — cancel errors (QUI-893)', () => {
  let fixture: ComponentFixture<LayawayDetailPageComponent>;
  let api: jasmine.SpyObj<LayawayApiService>;
  let toast: jasmine.SpyObj<ToastService>;

  const PLAN = {
    id: 5,
    plan_number: 'LAY-00001',
    state: 'overdue',
    paid_amount: 14500,
    layaway_installments: [],
  } as unknown as LayawayPlan;

  const httpError = (status: number, error_code: string, message: string) =>
    new HttpErrorResponse({
      status,
      error: { statusCode: status, error_code, message },
    });

  beforeEach(async () => {
    api = jasmine.createSpyObj<LayawayApiService>('LayawayApiService', [
      'getById',
      'cancel',
    ]);
    api.getById.and.returnValue(of({ success: true, data: PLAN }));
    toast = jasmine.createSpyObj<ToastService>('ToastService', [
      'success',
      'error',
    ]);

    await TestBed.configureTestingModule({
      imports: [LayawayDetailPageComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: LayawayApiService, useValue: api },
        { provide: ToastService, useValue: toast },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: new Map([['id', '5']]) } },
        },
        {
          provide: PaymentMethodsService,
          useValue: { getStorePaymentMethods: () => of({ data: [] }) },
        },
        { provide: CurrencyFormatService, useValue: { format: String } },
      ],
    })
      .overrideComponent(LayawayDetailPageComponent, {
        set: { template: '', imports: [] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(LayawayDetailPageComponent);
  });

  afterEach(() => fixture.destroy());

  function openWithCash(): LayawayDetailPageComponent {
    const component = fixture.componentInstance;
    component.openCancelModal();
    component.cancelReason.set('Cliente desiste');
    component.cancelRefundMethod.set('cash');
    return component;
  }

  it('CASH_SESSION_REQUIRED_001 → modal stays open with the backend reason, no success', () => {
    api.cancel.and.returnValue(
      throwError(() =>
        httpError(409, 'CASH_SESSION_REQUIRED_001', 'Abre tu caja para registrar pagos.'),
      ),
    );
    const component = openWithCash();

    component.submitCancel();

    expect(component.showCancelModal()).toBeTrue();
    expect(component.cancelError()).toBe('Abre tu caja para registrar pagos.');
    expect(toast.error).toHaveBeenCalledWith('Abre tu caja para registrar pagos.');
    expect(toast.success).not.toHaveBeenCalled();
    expect(component.isProcessingCancel()).toBeFalse();
    expect(api.getById).toHaveBeenCalledTimes(1);
  });

  it('LAY_STATE_001 → shows the curated message, never "Plan cancelado"', () => {
    api.cancel.and.returnValue(
      throwError(() =>
        httpError(409, 'LAY_STATE_001', 'Invalid layaway plan state transition'),
      ),
    );
    const component = openWithCash();

    component.submitCancel();

    expect(component.showCancelModal()).toBeTrue();
    expect(component.cancelError()).toBe(
      'No se puede realizar esta accion en el estado actual del plan.',
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('reopening the modal clears a previous error', () => {
    api.cancel.and.returnValue(
      throwError(() =>
        httpError(400, 'LAY_REFUND_METHOD_REQUIRED_001', 'x'),
      ),
    );
    const component = openWithCash();
    component.submitCancel();
    expect(component.cancelError()).toBeTruthy();

    component.closeCancelModal();
    component.openCancelModal();

    expect(component.cancelError()).toBeNull();
  });

  it('2xx → closes the modal, reloads the plan and shows "Plan cancelado"', () => {
    api.cancel.and.returnValue(
      of({ success: true, data: { ...PLAN, state: 'cancelled' } as LayawayPlan }),
    );
    const component = openWithCash();

    component.submitCancel();

    expect(component.showCancelModal()).toBeFalse();
    expect(component.cancelError()).toBeNull();
    expect(toast.success).toHaveBeenCalledWith('Plan cancelado');
    expect(toast.error).not.toHaveBeenCalled();
    expect(api.getById).toHaveBeenCalledTimes(2);
  });
});
