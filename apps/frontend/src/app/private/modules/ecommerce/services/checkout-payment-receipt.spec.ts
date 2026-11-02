import { HttpClient } from '@angular/common/http';
import { TenantFacade } from '../../../../core/store/tenant/tenant.facade';
import { CheckoutService } from './checkout.service';

/**
 * Soporte de pago obligatorio (`ecommerce.checkout.require_payment_receipt`):
 * aplica solo a transferencia. Datáfono conserva el adjunto como opcional.
 * Este accessor alimenta el `[required]` del modal de instrucciones y los
 * gates de avance/finalización del checkout.
 */
describe('CheckoutService.requiresPaymentReceiptFor', () => {
  function serviceWithFlag(flag: boolean | undefined): CheckoutService {
    const tenant = {
      getCurrentDomainConfig: () => ({
        customConfig: {
          ecommerce: {
            checkout: flag === undefined ? {} : { require_payment_receipt: flag },
          },
        },
      }),
    } as unknown as TenantFacade;
    return new CheckoutService({} as HttpClient, tenant);
  }

  it('flag activo: transferencia exige soporte', () => {
    expect(serviceWithFlag(true).requiresPaymentReceiptFor('bank_transfer')).toBeTrue();
  });

  it('flag activo: datáfono NO exige soporte', () => {
    expect(serviceWithFlag(true).requiresPaymentReceiptFor('voucher')).toBeFalse();
  });

  it('flag activo: otros métodos o sin método no exigen soporte', () => {
    const service = serviceWithFlag(true);
    expect(service.requiresPaymentReceiptFor('cash_on_delivery')).toBeFalse();
    expect(service.requiresPaymentReceiptFor(undefined)).toBeFalse();
  });

  it('flag apagado o ausente: ningún método exige soporte', () => {
    for (const flag of [false, undefined]) {
      const service = serviceWithFlag(flag);
      expect(service.requiresPaymentReceiptFor('bank_transfer')).toBeFalse();
      expect(service.requiresPaymentReceiptFor('voucher')).toBeFalse();
    }
  });
});
