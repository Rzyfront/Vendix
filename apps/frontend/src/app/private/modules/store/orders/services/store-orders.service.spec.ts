import { TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';

import { StoreOrdersService } from './store-orders.service';
import { StoreContextService } from '../../../../../core/services/store-context.service';
import { environment } from '../../../../../../environments/environment';

/**
 * CP-POS-CREAR-EDITAR-COBRAR-001 — G.1 / B.3
 *
 * El POS necesita distinguir `POS_CUSTOMER_REQUIRED_001` de
 * `POS_STOCK_INSUFFICIENT_001` de `ORD_EDIT_STATE_CHANGED_001` sin parsear
 * texto libre. Estas pruebas fijan ese contrato:
 *
 *  - `extractApiError` devuelve las cuatro piezas: copy de usuario, código
 *    tipado, `details` y el mensaje de desarrollo.
 *  - `flowPayOrder` propaga el `errorCode` al `catchError` del caller — si lo
 *    aplasta a un string, el cajero recibe un toast genérico y soporte no
 *    puede distinguir un fallo de stock de uno de estado.
 */
describe('StoreOrdersService — typed error contract', () => {
  let service: StoreOrdersService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        StoreOrdersService,
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: StoreContextService,
          useValue: { getStoreId: () => 1, storeId: () => 1 },
        },
      ],
    });

    service = TestBed.inject(StoreOrdersService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  describe('extractApiError', () => {
    it('devuelve message, errorCode, details y devMessage de un error tipado del backend', () => {
      const backendError = {
        error: {
          success: false,
          error_code: 'POS_CUSTOMER_REQUIRED_001',
          message: 'POS order requires a valid customer_id',
          details: { reason: 'missing_or_invalid_customer_id' },
        },
        status: 422,
      };

      const parsed = service.extractApiError(backendError);

      expect(parsed.errorCode).toBe('POS_CUSTOMER_REQUIRED_001');
      expect(parsed.details).toEqual({
        reason: 'missing_or_invalid_customer_id',
      });
      // El copy de usuario nunca es vacío: un toast en blanco es peor que uno
      // técnico.
      expect(typeof parsed.message).toBe('string');
      expect(parsed.message.length).toBeGreaterThan(0);
      expect('devMessage' in parsed).toBeTrue();
    });

    it('no inventa un errorCode cuando el backend no lo manda', () => {
      const parsed = service.extractApiError({
        error: { message: 'Internal server error' },
        status: 500,
      });

      expect(parsed.errorCode).toBeFalsy();
      expect(typeof parsed.message).toBe('string');
    });
  });

  describe('flowPayOrder', () => {
    it('propaga errorCode y details en el error emitido', (done) => {
      service.flowPayOrder('500', {
        store_payment_method_id: 1,
        payment_type: 'direct',
        amount_received: 1000,
      } as any).subscribe({
        next: () => done.fail('no debe emitir éxito'),
        error: (err: any) => {
          expect(err.errorCode).toBe('ORD_FLOW_PAYMENT_FAILED_001');
          expect(err.details).toEqual({ order_state: 'shipped' });
          expect(typeof err.message).toBe('string');
          expect(err.message.length).toBeGreaterThan(0);
          done();
        },
      });

      const req = httpMock.expectOne(
        `${environment.apiUrl}/store/orders/500/flow/pay`,
      );
      expect(req.request.method).toBe('POST');
      req.flush(
        {
          success: false,
          error_code: 'ORD_FLOW_PAYMENT_FAILED_001',
          message: 'Order cannot be paid in its current state',
          details: { order_state: 'shipped' },
        },
        { status: 409, statusText: 'Conflict' },
      );
    });

    it('devuelve el payload de pago en el camino feliz', (done) => {
      service.flowPayOrder('500', {
        store_payment_method_id: 1,
        payment_type: 'direct',
        amount_received: 1000,
      } as any).subscribe({
        next: (res: any) => {
          expect(res.payment.state).toBe('succeeded');
          expect(res.order.grand_total).toBe(1000);
          done();
        },
        error: () => done.fail('no debe fallar'),
      });

      httpMock
        .expectOne(`${environment.apiUrl}/store/orders/500/flow/pay`)
        .flush({
          success: true,
          data: {
            payment: { id: 1, state: 'succeeded' },
            order: { id: 500, grand_total: 1000, state: 'completed' },
          },
        });
    });
  });
});
