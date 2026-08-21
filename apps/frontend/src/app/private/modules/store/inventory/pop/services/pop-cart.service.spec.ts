import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { PopCartService } from './pop-cart.service';
import { WithholdingTaxService } from '../../../withholding-tax/services/withholding-tax.service';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import {
  AddToPopCartRequest,
  PopCartItem,
} from '../interfaces/pop-cart.interface';

/**
 * CP-ORC-POP-MODAL-DISCOUNT-001 — guard rails for per-line discount input.
 *
 * El descuento comercial por línea es un porcentaje entero en [0, 100].
 * Antes, `setItemDiscount` clampeaba con `Math.min(100, Math.max(0,
 * Number(x) || 0))`: `NaN` sobrevivía el `||` (`NaN || 0` es `NaN`),
 * `Math.max(0, NaN)` es `NaN`, y el resultado se escribía como `discount`
 * sin guard. Además, nunca redondeaba: 20.6 quedaba en 20.6, lo que el
 * backend rechazaba porque la columna `discount_percentage` es entero.
 *
 * El helper `normalizeDiscount` centraliza el contrato. Estos tests
 * validan AMBOS seams: el editor (`setItemDiscount`) y la entrada
 * (`addToCart`).
 */
describe('PopCartService — discount normalization (CP-ORC-POP-MODAL-DISCOUNT-001)', () => {
  let service: PopCartService;

  const baseProduct: any = {
    id: 1,
    name: 'Test product',
    code: 'TST-001',
    price: 1000,
    cost: 100,
    stock: 100,
    is_active: true,
  };

  /**
   * Suscribe al observable de `addToCart` para que el side-effect del
   * signal `_cartState.set(newState)` se materialice antes de leer
   * `service.currentState`. Sin subscribe, el item queda pendiente en el
   * observable y los asserts fallan.
   */
  function addItem(discount?: number): PopCartItem {
    const req: AddToPopCartRequest = {
      product: baseProduct,
      quantity: 1,
      unit_cost: 100,
      discount,
    };
    service.addToCart(req).subscribe();
    return service.currentState.items[0];
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        PopCartService,
        {
          provide: WithholdingTaxService,
          useValue: {
            previewWithholding: () =>
              of({ lines: [], total_withholding: 0 }),
          },
        },
        {
          provide: AuthFacade,
          useValue: {
            // toSignal con initialValue `[]` ⇒ fiscal inactivo ⇒ el preview
            // reactivo nunca dispara la llamada al backend.
            activeFiscalAreas: () => [],
          },
        },
      ],
    });
    service = TestBed.inject(PopCartService);
  });

  describe('setItemDiscount', () => {
    it('0.20 → 0 (rounded down)', () => {
      const item = addItem();
      service.setItemDiscount(item.id, 0.2);
      expect(service.currentState.items[0].discount).toBe(0);
    });

    it('20.6 → 21 (rounded up)', () => {
      const item = addItem();
      service.setItemDiscount(item.id, 20.6);
      expect(service.currentState.items[0].discount).toBe(21);
    });

    it('100 → 100 (upper boundary, no clamp needed)', () => {
      const item = addItem();
      service.setItemDiscount(item.id, 100);
      expect(service.currentState.items[0].discount).toBe(100);
    });

    it('-1 → 0 (clamped at the lower boundary)', () => {
      const item = addItem(50);
      service.setItemDiscount(item.id, -1);
      expect(service.currentState.items[0].discount).toBe(0);
    });

    it('NaN → state unchanged (no silent wipe to 0)', () => {
      const item = addItem(33);
      service.setItemDiscount(item.id, NaN);
      expect(service.currentState.items[0].discount).toBe(33);
    });

    it('undefined → state unchanged', () => {
      const item = addItem(33);
      service.setItemDiscount(item.id, undefined);
      expect(service.currentState.items[0].discount).toBe(33);
    });

    it('Infinity → state unchanged', () => {
      const item = addItem(33);
      service.setItemDiscount(item.id, Infinity);
      expect(service.currentState.items[0].discount).toBe(33);
    });

    it('-Infinity → state unchanged', () => {
      const item = addItem(33);
      service.setItemDiscount(item.id, -Infinity);
      expect(service.currentState.items[0].discount).toBe(33);
    });

    it('50.49 → 50 (banker-neutral: rounds toward zero at .49)', () => {
      const item = addItem();
      service.setItemDiscount(item.id, 50.49);
      expect(service.currentState.items[0].discount).toBe(50);
    });

    it('50.5 → 51 (banker-neutral: rounds away from zero at .5)', () => {
      const item = addItem();
      service.setItemDiscount(item.id, 50.5);
      expect(service.currentState.items[0].discount).toBe(51);
    });
  });

  describe('addToCart — discount passes through normalizer', () => {
    it('discount: 0.20 → item.discount === 0', () => {
      addItem(0.2);
      expect(service.currentState.items[0].discount).toBe(0);
    });

    it('discount: 20 → item.discount === 20', () => {
      addItem(20);
      expect(service.currentState.items[0].discount).toBe(20);
    });

    it('discount: 20.6 → item.discount === 21', () => {
      addItem(20.6);
      expect(service.currentState.items[0].discount).toBe(21);
    });
  });
});
