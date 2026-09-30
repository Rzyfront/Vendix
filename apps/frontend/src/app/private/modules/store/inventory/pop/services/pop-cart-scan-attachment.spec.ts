import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { PopCartService } from './pop-cart.service';
import { WithholdingTaxService } from '../../../withholding-tax/services/withholding-tax.service';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';

describe('PopCartService — scan_attachment (QUI-855)', () => {
  let service: PopCartService;

  const att = {
    key: 'store-1/purchase-orders/scan/a.pdf',
    file_name: 'a.pdf',
    file_type: 'application/pdf',
    file_size: 10,
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        PopCartService,
        {
          provide: WithholdingTaxService,
          useValue: {
            previewWithholding: () => of({ lines: [], total_withholding: 0 }),
          },
        },
        {
          provide: AuthFacade,
          useValue: { activeFiscalAreas: () => [], userStore: () => null },
        },
      ],
    });
    service = TestBed.inject(PopCartService);
  });

  it('guarda el adjunto en el estado y un segundo escaneo lo reemplaza', () => {
    service.setScanAttachment(att);
    expect(service.currentState.scan_attachment).toEqual(att);

    const other = { ...att, key: 'store-1/purchase-orders/scan/b.pdf', file_name: 'b.pdf' };
    service.setScanAttachment(other);
    expect(service.currentState.scan_attachment).toEqual(other);
  });

  it('quitar el adjunto lo limpia', () => {
    service.setScanAttachment(att);
    service.setScanAttachment(null);
    expect(service.currentState.scan_attachment).toBeUndefined();
  });

  it('vaciar el carrito limpia el adjunto', () => {
    service.setScanAttachment(att);
    service.clearCart().subscribe();
    expect(service.currentState.scan_attachment).toBeUndefined();
  });

  it('el estado serializable (el que va a localStorage) conserva el adjunto', () => {
    service.setScanAttachment(att);
    const roundTrip = JSON.parse(JSON.stringify(service.currentState));
    expect(roundTrip.scan_attachment).toEqual(att);
  });
});
