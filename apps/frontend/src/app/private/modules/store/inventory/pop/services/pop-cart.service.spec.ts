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

    it('101 → 100 (upper-clamp boundary, audit 7b)', () => {
      // Por encima del 100 se clampea: un typo "1000" no puede descontar
      // más que el precio entero de la línea y envenenar el FIFO layer.
      const item = addItem();
      service.setItemDiscount(item.id, 101);
      expect(service.currentState.items[0].discount).toBe(100);
    });

    it('0 → 0 (lower boundary, explicit)', () => {
      // 0 explícito sí atraviesa el normalizador y se persiste como 0
      // (no es lo mismo que `null`/`undefined`, que se descartan en seco).
      const item = addItem();
      service.setItemDiscount(item.id, 0);
      expect(service.currentState.items[0].discount).toBe(0);
    });

    it('null → state unchanged (audit 7a: normalizeDiscount null branch)', () => {
      // `null` activa la guarda de `setItemDiscount` que retorna sin
      // tocar el state. La línea conserva el descuento previo intacto:
      // no se sobrescribe a 0 ni a NaN.
      const item = addItem(50);
      service.setItemDiscount(item.id, null);
      expect(service.currentState.items[0].discount).toBe(50);
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

    it('discount: NaN → item.discount === 0 (audit 7c: addToCart seam)', () => {
      // El escáner de facturas puede llegar con un payload corrupto. El
      // normalizador aplicado en `processAddToCart` rechaza NaN ⇒ 0, así
      // que el alta de la línea sigue siendo válida (descuento cero).
      addItem(NaN);
      expect(service.currentState.items[0].discount).toBe(0);
    });

    it('discount: 101 → item.discount === 100 (audit 7c: addToCart upper clamp)', () => {
      // Mismo clamp que en `setItemDiscount`: una factura con 101 % no
      // envenena la línea. El alta nace ya clampeada.
      addItem(101);
      expect(service.currentState.items[0].discount).toBe(100);
    });
  });

  /**
   * Paridad del descuento del escáner de facturas.
   *
   * La factura del proveedor imprime PESOS. El frontend los convertía a un
   * porcentaje ENTERO (`Math.round`) antes de entrar al carrito, y el resto que
   * el redondeo no podía representar se inyectaba al descuento de CABECERA —
   * que el backend prorratea entre TODAS las líneas por peso bruto. El dinero
   * cambiaba de línea, y como las capas de costo FIFO se escriben por línea, el
   * costeo quedaba mal.
   *
   * `discount_amount` (dinero, base neta) es ahora la fuente de verdad y GANA
   * sobre `discount` (%), igual que en `PurchaseOrdersService.deriveLineTax`.
   */
  describe('discount_amount — el monto de la factura no se degrada', () => {
    /**
     * Línea de bruto 10 000 (1000 × 10). Un descuento de 1234 es 12,34 %: un
     * porcentaje entero NO puede representarlo, que es exactamente el caso que
     * el bug perdía.
     */
    function addLineWithMoneyDiscount(discount_amount: number): PopCartItem {
      const req: AddToPopCartRequest = {
        product: baseProduct,
        quantity: 10,
        unit_cost: 1000,
        discount_amount,
      };
      service.addToCart(req).subscribe();
      return service.currentState.items[0];
    }

    it('el monto llega intacto al resumen y baja el subtotal exactamente en esa cifra', () => {
      // `has_vat` arranca apagado ⇒ sin IVA, el neto es bruto − descuento.
      // bruto 10 000 − 1234 = 8766. Con la conversión a porcentaje entero el
      // descuento habría sido 1200 y el subtotal 8800: 34 pesos desplazados.
      addLineWithMoneyDiscount(1234);

      const summary = service.currentState.summary;
      expect(summary.discount_amount).toBe(1234);
      expect(summary.subtotal).toBe(8766);
      expect(summary.subtotal).toBe(10000 - 1234);
    });

    it('el monto se preserva en el item y NO se traduce a porcentaje', () => {
      const item = addLineWithMoneyDiscount(1234);

      expect(service.currentState.items[0].discount_amount).toBe(1234);
      // `discount` (%) queda en 0: es la vía de la captura manual y no describe
      // este descuento. Dos cifras con valor a la vez dejarían al operador sin
      // saber cuál se aplicó.
      expect(service.currentState.items[0].discount).toBe(0);
      expect(item.id).toBeTruthy();
    });

    it('un re-escaneo de la misma línea reescribe el monto en vez de perderlo', () => {
      // La rama "el ítem YA está en el carrito" hacía `...existingItem` y sólo
      // pisaba la cantidad: el monto del escaneo anterior sobrevivía mientras la
      // cantidad sí se actualizaba. El ÚLTIMO escaneo gana, como con `discount`,
      // `unit_cost` y `tax_rate`.
      addLineWithMoneyDiscount(1234);
      addLineWithMoneyDiscount(500);

      expect(service.currentState.items.length).toBe(1);
      expect(service.currentState.items[0].quantity).toBe(20);
      expect(service.currentState.items[0].discount_amount).toBe(500);
    });

    it('setItemDiscount(10) limpia el monto y pasa a aplicar el 10 %', () => {
      // Sin la limpieza, el monto heredado del escaneo gana por precedencia y
      // teclear el porcentaje no mueve ninguna cifra — un CTA mudo.
      const item = addLineWithMoneyDiscount(1234);
      service.setItemDiscount(item.id, 10);

      const line = service.currentState.items[0];
      expect(line.discount).toBe(10);
      expect(line.discount_amount).toBeUndefined();
      // 10 % de 10 000 = 1000 ⇒ subtotal 9000.
      expect(service.currentState.summary.discount_amount).toBe(1000);
      expect(service.currentState.summary.subtotal).toBe(9000);
    });

    it('setItemDiscountAmount fija el monto y pone el porcentaje en 0', () => {
      const item = addItem(25); // línea con 25 % tecleado a mano
      service.setItemDiscountAmount(item.id, 40);

      const line = service.currentState.items[0];
      expect(line.discount_amount).toBe(40);
      expect(line.discount).toBe(0);
      // bruto 100 (1 × 100) − 40 = 60.
      expect(service.currentState.summary.discount_amount).toBe(40);
      expect(service.currentState.summary.subtotal).toBe(60);
    });

    it('setItemDiscountAmount rechaza null/undefined/no-finito sin tocar el estado', () => {
      const item = addLineWithMoneyDiscount(1234);

      service.setItemDiscountAmount(item.id, null);
      expect(service.currentState.items[0].discount_amount).toBe(1234);

      service.setItemDiscountAmount(item.id, undefined);
      expect(service.currentState.items[0].discount_amount).toBe(1234);

      service.setItemDiscountAmount(item.id, NaN);
      expect(service.currentState.items[0].discount_amount).toBe(1234);

      service.setItemDiscountAmount(item.id, Infinity);
      expect(service.currentState.items[0].discount_amount).toBe(1234);
    });

    it('setItemDiscountAmount clampa un monto negativo a 0', () => {
      // Un "descuento" negativo es un recargo: tendría que viajar como flete,
      // no como rebaja que baja la base gravable.
      const item = addLineWithMoneyDiscount(1234);
      service.setItemDiscountAmount(item.id, -50);

      expect(service.currentState.items[0].discount_amount).toBe(0);
      expect(service.currentState.summary.discount_amount).toBe(0);
      expect(service.currentState.summary.subtotal).toBe(10000);
    });
  });
});

/**
 * CP-PURCHASE-TRANSPARENCY (T2/D.1) — el rechazo del modo de flete deja de ser
 * mudo.
 *
 * `setShippingCostAllocation` descarta el modo cuando no hay flete (el backend
 * responde 400 a `prorate` sin monto). El rechazo es correcto; lo que no lo era
 * es que ocurriera en silencio: `app-toggle` ya se había pintado solo al hacer
 * clic y nadie revertía la pintura, así que la pantalla afirmaba «Prorratear»
 * sobre un carrito sin modo. Ahora la función DICE si aplicó.
 */
describe('PopCartService — contrato de setShippingCostAllocation (T2/D.1)', () => {
  let service: PopCartService;

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
          useValue: { activeFiscalAreas: () => [] },
        },
      ],
    });
    service = TestBed.inject(PopCartService);
  });

  it('sin flete devuelve false y NO escribe el modo', () => {
    service.setShippingMethod('freight');
    service.setShippingCost(0);

    expect(service.setShippingCostAllocation('expense')).toBe(false);
    expect(service.currentState.shippingCostAllocation).toBeUndefined();
  });

  it('con flete devuelve true y escribe el modo pedido', () => {
    service.setShippingMethod('freight');
    service.setShippingCost(15000);

    // `setShippingCost` siembra `prorate`: el modo es obligatorio en cuanto hay
    // monto.
    expect(service.currentState.shippingCostAllocation).toBe('prorate');

    expect(service.setShippingCostAllocation('expense')).toBe(true);
    expect(service.currentState.shippingCostAllocation).toBe('expense');

    expect(service.setShippingCostAllocation('prorate')).toBe(true);
    expect(service.currentState.shippingCostAllocation).toBe('prorate');
  });

  it('volver el flete a cero borra el modo y vuelve a rechazar', () => {
    service.setShippingMethod('freight');
    service.setShippingCost(15000);
    service.setShippingCost(0);

    expect(service.currentState.shippingCostAllocation).toBeUndefined();
    expect(service.setShippingCostAllocation('prorate')).toBe(false);
    expect(service.currentState.shippingCostAllocation).toBeUndefined();
  });
});
