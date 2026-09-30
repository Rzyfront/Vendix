import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { PopCartService } from './pop-cart.service';
import { WithholdingTaxService } from '../../../withholding-tax/services/withholding-tax.service';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';

const STORE_ID = 77;

describe('PopCartService — scan_attachment (QUI-855)', () => {
  let service: PopCartService;

  const att = {
    key: 'store-1/purchase-orders/scan/a.pdf',
    file_name: 'a.pdf',
    file_type: 'application/pdf',
    file_size: 10,
  };

  beforeEach(() => {
    localStorage.removeItem(`vendix_pop_cart_${STORE_ID}`);
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
          useValue: { activeFiscalAreas: () => [], userStore: () => ({ id: STORE_ID }) },
        },
      ],
    });
    service = TestBed.inject(PopCartService);
  });

  afterEach(() => {
    jasmine.clock().uninstall();
    localStorage.removeItem(`vendix_pop_cart_${STORE_ID}`);
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

  it('el adjunto sobrevive al guardado/carga REAL de localStorage del servicio', () => {
    // El proyecto corre zoneless: sin fakeAsync, el debounce se avanza con jasmine.clock.
    // Guardado: `initPersistence` escribe con debounce de 250 ms. Necesita al
    // menos una línea (un carrito vacío borra la clave).
    // mockDate: el debounce de rxjs compara contra Date.now().
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date());
    service.addToCart({ product: { id: 1, name: 'P', code: 'P1', price: 1, cost: 1, stock: 1, is_active: true } as any, quantity: 1, unit_cost: 1 }).subscribe();
    service.setScanAttachment(att);
    TestBed.tick();
    jasmine.clock().tick(300);

    const raw = localStorage.getItem(`vendix_pop_cart_${STORE_ID}`);
    expect(raw).withContext('el servicio escribió el carrito').not.toBeNull();

    // Carga: el mismo `loadFromStorage` que hidrata al abrir la pantalla.
    const loaded = (service as any).loadFromStorage();
    expect(loaded.scan_attachment).toEqual(att);
    expect(loaded.items.length).toBe(1);
  });
});
