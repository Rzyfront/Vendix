import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import {
  PopCartService,
  countLinesBlockingSubmit,
  normalizePopLineTaxType,
  submitBlockMessage,
} from './pop-cart.service';
import { WithholdingTaxService } from '../../../withholding-tax/services/withholding-tax.service';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import {
  AddToPopCartRequest,
  PopCartItem,
  PopCartState,
  PopProduct,
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
            // QUI-891: quitar la última línea llama a clearStorage() sync ⇒
            // el mock necesita userStore como en producción (signal).
            userStore: () => ({ id: 1 }),
          },
        },
      ],
    });
    service = TestBed.inject(PopCartService);
  });

  describe('setItemDiscount', () => {
    // QUI-855 (fix 8): el % manual conserva 2 decimales (la columna es
    // Decimal(5,2) y el DTO acepta decimales): 1,5 % no salta a 2 %.
    it('0.20 → 0.2 (2 decimales)', () => {
      const item = addItem();
      service.setItemDiscount(item.id, 0.2);
      expect(service.currentState.items[0].discount).toBe(0.2);
    });

    it('20.6 → 20.6 (2 decimales)', () => {
      const item = addItem();
      service.setItemDiscount(item.id, 20.6);
      expect(service.currentState.items[0].discount).toBe(20.6);
    });

    it('33.333 → 33.33 (redondea al 2.º decimal)', () => {
      const item = addItem();
      service.setItemDiscount(item.id, 33.333);
      expect(service.currentState.items[0].discount).toBe(33.33);
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

    it('50.49 → 50.49 (2 decimales)', () => {
      const item = addItem();
      service.setItemDiscount(item.id, 50.49);
      expect(service.currentState.items[0].discount).toBe(50.49);
    });

    it('50.5 → 50.5 (2 decimales)', () => {
      const item = addItem();
      service.setItemDiscount(item.id, 50.5);
      expect(service.currentState.items[0].discount).toBe(50.5);
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
    it('discount: 0.20 → item.discount === 0.2 (2 decimales, igual que setItemDiscount)', () => {
      addItem(0.2);
      expect(service.currentState.items[0].discount).toBe(0.2);
    });

    it('discount: 20 → item.discount === 20', () => {
      addItem(20);
      expect(service.currentState.items[0].discount).toBe(20);
    });

    it('discount: 20.6 → item.discount === 20.6 (2 decimales)', () => {
      addItem(20.6);
      expect(service.currentState.items[0].discount).toBe(20.6);
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
          // QUI-891: userStore como en producción (clearStorage sync al vaciar).
          useValue: { activeFiscalAreas: () => [], userStore: () => ({ id: 1 }) },
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


/**
 * QUI-855 (auditoría) — tipo de impuesto legacy, scan_attachment al vaciar
 * línea por línea y bloqueo de envío por impuesto sin confirmar.
 */
describe('PopCartService — QUI-855 correcciones de auditoría', () => {
  let service: PopCartService;
  const product: any = { id: 1, name: 'P', code: 'P1', price: 1000, cost: 100, stock: 1, is_active: true };
  const att = { key: 'k/a.pdf', file_name: 'a.pdf', file_type: 'application/pdf', file_size: 1 };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        PopCartService,
        { provide: WithholdingTaxService, useValue: { previewWithholding: () => of({ lines: [], total_withholding: 0 }) } },
        // QUI-891: userStore como en producción (clearStorage sync al vaciar).
        { provide: AuthFacade, useValue: { activeFiscalAreas: () => [], userStore: () => ({ id: 1 }) } },
      ],
    });
    service = TestBed.inject(PopCartService);
  });

  let nextProductId = 1000;
  function add(over: Partial<AddToPopCartRequest> = {}): PopCartItem {
    const id = nextProductId++;
    service.addToCart({ product: { ...product, id }, quantity: 1, unit_cost: 100, ...over }).subscribe();
    return service.currentState.items.find((i) => i.product.id === id)!;
  }

  describe('tax_type legacy', () => {
    it('setItemTaxes conserva «inc» (no reclasifica a iva al editar)', () => {
      const item = add({ tax_type: 'inc', tax_rate: 8 });
      expect(item.tax_type).toBe('inc');
      service.setItemTaxes(item.id, [{ tax_type: 'inc', tax_rate: 8, calc_mode: 'percent', add_to_cost: true } as any]);
      expect(service.currentState.items[0].tax_type).toBe('inc');
    });

    it('un tax_type desconocido o vacío cae a iva', () => {
      expect(normalizePopLineTaxType(undefined)).toBe('iva');
      expect(normalizePopLineTaxType('zzz')).toBe('iva');
      for (const t of ['iva', 'inc', 'icui', 'ibua']) expect(normalizePopLineTaxType(t)).toBe(t);
    });
  });

  describe('scan_attachment al vaciar línea por línea', () => {
    it('quitar la última línea limpia el adjunto; con líneas restantes lo conserva', () => {
      const a = add();
      const b = add();
      service.setScanAttachment(att);

      service.removeFromCart(a.id).subscribe();
      expect(service.currentState.items.length).toBe(1);
      expect(service.currentState.scan_attachment).toEqual(att);

      service.removeFromCart(b.id).subscribe();
      expect(service.currentState.items.length).toBe(0);
      expect(service.currentState.scan_attachment).toBeUndefined();
    });
  });

  describe('bloqueo de envío por impuesto sin confirmar', () => {
    it('línea manual sin tasa + has_vat ⇒ bloquea con el mensaje; has_vat apagado ⇒ no', () => {
      add({ tax_rate: null } as any);
      expect(service.currentState.items[0].tax_needs_review).toBeTrue();

      expect(submitBlockMessage(service.currentState)).toBeNull(); // has_vat apagado
      service.setHasVat(true);
      expect(submitBlockMessage(service.currentState)).toBe('Confirma el impuesto de 1 línea');

      service.setItemTaxRate(service.currentState.items[0].id, 19); // confirma
      expect(submitBlockMessage(service.currentState)).toBeNull();
    });

    it('tax_needs_review del request bloquea aunque traiga tasa, hasta confirmarla', () => {
      add({ tax_rate: 19, tax_needs_review: true });
      expect(service.currentState.items[0].tax_needs_review).toBeTrue();
      service.setHasVat(true);
      expect(submitBlockMessage(service.currentState)).toBe('Confirma el impuesto de 1 línea');
      service.setItemTaxRate(service.currentState.items[0].id, 19);
      expect(submitBlockMessage(service.currentState)).toBeNull();
    });

    it('una línea con tax_error también bloquea', () => {
      service.setHasVat(true);
      const state: any = { has_vat: true, items: [{ tax_error: 'combinación inválida' }, { tax_needs_review: true }] };
      expect(countLinesBlockingSubmit(state)).toBe(2);
      expect(submitBlockMessage(state)).toBe('Confirma el impuesto de 2 líneas');
    });

    it('el kernel rechaza la línea ⇒ el carrito marca tax_error y bloquea; corregirla desbloquea', () => {
      service.setHasVat(true);
      // IBUA incluido de 500 por unidad sobre un bruto de 100: base negativa.
      const item = add({
        prices_include_tax: true,
        taxes: [{ tax_type: 'ibua', calc_mode: 'fixed_per_unit', fixed_amount_per_unit: 500, is_inclusive: true, add_to_cost: true } as any],
      });
      expect(service.currentState.items[0].tax_error).toBeTruthy();
      expect(submitBlockMessage(service.currentState)).toBe('Confirma el impuesto de 1 línea');

      service.setItemTaxes(item.id, [{ tax_type: 'ibua', calc_mode: 'fixed_per_unit', fixed_amount_per_unit: 5, is_inclusive: true, add_to_cost: true } as any]);
      expect(service.currentState.items[0].tax_error).toBeUndefined();
      expect(submitBlockMessage(service.currentState)).toBeNull();
    });
  });
});

describe('PopCartService — QUI-891 la última línea eliminada no resucita', () => {
  let service: PopCartService;
  let userStore: WritableSignal<{ id: number } | null>;
  let storage: Storage;
  let removeStoredItem: (key: string) => void;
  const STORE_ID = 7;
  const KEY = `vendix_pop_cart_${STORE_ID}`;
  const OTHER_KEY = `vendix_pop_cart_${STORE_ID + 1}`;
  const product: PopProduct = { id: 1, name: 'P', code: 'P1', price: 1000, cost: 100, stock: 1, is_active: true };

  beforeEach(() => {
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date());
    storage = localStorage;
    // Conservar el método nativo para limpiar incluso si un spec bloquea el
    // getter o removeItem (Jasmine restaura los spies después del afterEach).
    removeStoredItem = storage.removeItem.bind(storage);
    removeStoredItem(KEY);
    removeStoredItem(OTHER_KEY);
    userStore = signal<{ id: number } | null>({ id: STORE_ID });
    TestBed.configureTestingModule({
      providers: [
        PopCartService,
        { provide: WithholdingTaxService, useValue: { previewWithholding: () => of({ lines: [], total_withholding: 0 }) } },
        { provide: AuthFacade, useValue: { activeFiscalAreas: () => [], userStore } },
      ],
    });
    service = TestBed.inject(PopCartService);
  });

  afterEach(() => {
    try {
      TestBed.resetTestingModule(); // destruir subscriptions antes de soltar el reloj
      removeStoredItem(KEY);
      removeStoredItem(OTHER_KEY);
    } finally {
      jasmine.clock().uninstall();
    }
  });

  function addOne(productId = product.id): PopCartItem {
    service
      .addToCart({ product: { ...product, id: productId }, quantity: 1, unit_cost: 100 })
      .subscribe();
    return service.currentState.items.find((item) => item.product.id === productId)!;
  }

  function writeSnapshot(
    state = service.currentState,
    storeId = STORE_ID,
    savedAt = Date.now(),
    key = KEY,
  ): void {
    storage.setItem(key, JSON.stringify({ state, savedAt, storeId }));
  }

  function seedStorageWithOneLine(): void {
    addOne();
    writeSnapshot();
  }

  function expectEmptyCart(): void {
    expect(service.currentState.items.length).toBe(0);
    expect(service.currentState.summary.subtotal).toBe(0);
    expect(service.currentState.summary.total).toBe(0);
    expect(service.currentState.summary.itemCount).toBe(0);
    expect(service.currentState.summary.totalItems).toBe(0);
  }

  function flushPersistence(): void {
    TestBed.flushEffects();
    jasmine.clock().tick(300); // incluye el guardado debounced de 250 ms y el preview
    TestBed.flushEffects();
  }

  function snapshotWithDelayedStore(): PopCartState {
    userStore.set(null);
    TestBed.flushEffects();
    addOne();
    const snapshot = service.currentState;
    service.clearCart().subscribe();
    TestBed.flushEffects();
    return snapshot;
  }

  for (const operation of ['papelera', 'cantidad cero'] as const) {
    function remove(itemId: string, error: jasmine.Spy): void {
      const result$ = operation === 'papelera'
        ? service.removeFromCart(itemId)
        : service.updateCartItem({ itemId, quantity: 0 });
      result$.subscribe({ error });
    }

    it(`${operation}: borra el snapshot síncronamente y no restaura la única línea`, () => {
      seedStorageWithOneLine();
      TestBed.flushEffects();
      expect(storage.getItem(KEY)).not.toBeNull();
      const error = jasmine.createSpy('error');

      remove(service.currentState.items[0].id, error);
      expectEmptyCart();
      expect(storage.getItem(KEY)).toBeNull(); // antes de effects y debounce
      expect(error).not.toHaveBeenCalled();

      flushPersistence();
      expectEmptyCart();
      expect(storage.getItem(KEY)).toBeNull();
    });

    it(`${operation}: con dos líneas conserva la otra y su resumen`, () => {
      const first = addOne();
      const second = addOne(2);
      TestBed.flushEffects();
      const error = jasmine.createSpy('error');

      remove(first.id, error);
      expect(service.currentState.items.map((item) => item.id)).toEqual([second.id]);
      expect(service.currentState.summary.subtotal).toBe(100);
      expect(error).not.toHaveBeenCalled();
      flushPersistence();
      const saved = JSON.parse(storage.getItem(KEY)!);
      expect(saved.state.items.map((item: PopCartItem) => item.id)).toEqual([second.id]);
    });

    it(`${operation}: removeItem bloqueado no falla ni resucita el snapshot`, () => {
      seedStorageWithOneLine();
      TestBed.flushEffects();
      const snapshot = storage.getItem(KEY);
      const error = jasmine.createSpy('error');
      spyOn(Storage.prototype, 'removeItem').and.callFake(() => {
        throw new DOMException('storage blocked', 'SecurityError');
      });

      remove(service.currentState.items[0].id, error);
      expectEmptyCart();
      expect(error).not.toHaveBeenCalled();
      // El navegador impide borrar: no prometemos persistencia tras recargar.
      expect(storage.getItem(KEY)).toBe(snapshot);
      expect(flushPersistence).not.toThrow(); // saveToStorage(empty) también es seguro
      expectEmptyCart();
    });

    it(`${operation}: el getter de localStorage bloqueado tampoco aborta`, () => {
      seedStorageWithOneLine();
      TestBed.flushEffects();
      const error = jasmine.createSpy('error');
      spyOnProperty(window, 'localStorage', 'get').and.callFake(() => {
        throw new DOMException('storage access blocked', 'SecurityError');
      });

      remove(service.currentState.items[0].id, error);
      expectEmptyCart();
      expect(error).not.toHaveBeenCalled();
      expect(flushPersistence).not.toThrow();
      expectEmptyCart();
    });
  }

  it('el guard no vuelve a leer un snapshot aunque sobreviva o se reescriba después del borrado', () => {
    const getItem = spyOn(Storage.prototype, 'getItem').and.callThrough();
    TestBed.flushEffects(); // marca la tienda, todavía sin líneas
    expect(getItem).toHaveBeenCalledOnceWith(KEY);

    for (let attempt = 0; attempt < 2; attempt++) {
      const item = addOne();
      const snapshot = service.currentState;
      TestBed.flushEffects();
      service.removeFromCart(item.id).subscribe();
      writeSnapshot(snapshot); // aislar el guard del borrado síncrono
      TestBed.flushEffects();
      expectEmptyCart();
      expect(getItem).toHaveBeenCalledTimes(1);
      jasmine.clock().tick(300);
      TestBed.flushEffects();
      expectEmptyCart();
    }
  });

  it('clearCart conserva la mutación en memoria si removeItem lanza', () => {
    seedStorageWithOneLine();
    TestBed.flushEffects();
    spyOn(Storage.prototype, 'removeItem').and.throwError('storage blocked');
    const error = jasmine.createSpy('error');
    service.clearCart().subscribe({ error });

    expectEmptyCart();
    expect(error).not.toHaveBeenCalled();
    expect(flushPersistence).not.toThrow();
  });

  it('un setItem rechazado no genera excepción en el guardado debounced', () => {
    TestBed.flushEffects();
    const item = addOne();
    spyOn(Storage.prototype, 'setItem').and.throwError('quota exceeded');

    expect(flushPersistence).not.toThrow();
    expect(service.currentState.items[0].id).toBe(item.id);
  });

  it('getItem rechazado se intenta una sola vez en ese contexto', () => {
    const getItem = spyOn(Storage.prototype, 'getItem').and.throwError('storage blocked');
    expect(() => TestBed.flushEffects()).not.toThrow();
    const item = addOne();
    TestBed.flushEffects();
    service.removeFromCart(item.id).subscribe();
    flushPersistence();

    expectEmptyCart();
    expect(getItem).toHaveBeenCalledOnceWith(KEY);
  });

  it('el getter rechazado durante la primera hidratación no rompe el effect', () => {
    const getter = spyOnProperty(window, 'localStorage', 'get').and.callFake(() => {
      throw new DOMException('storage access blocked', 'SecurityError');
    });
    expect(() => TestBed.flushEffects()).not.toThrow();
    getter.and.returnValue(storage);
    const getItem = spyOn(Storage.prototype, 'getItem').and.callThrough();
    addOne();
    TestBed.flushEffects();
    service.removeFromCart(service.currentState.items[0].id).subscribe();
    flushPersistence();

    expectEmptyCart();
    expect(getItem).not.toHaveBeenCalled();
  });

  it('hidrata un snapshot válido cuando la tienda aparece tarde y no lo vuelve a leer', () => {
    const snapshot = snapshotWithDelayedStore();
    writeSnapshot(snapshot);
    const getItem = spyOn(Storage.prototype, 'getItem').and.callThrough();
    userStore.set({ id: STORE_ID });
    TestBed.flushEffects();
    expect(service.currentState.items[0].id).toBe(snapshot.items[0].id);
    expect(service.currentState.orderDate instanceof Date).toBeTrue();
    expect(getItem).toHaveBeenCalledOnceWith(KEY);

    service.removeFromCart(snapshot.items[0].id).subscribe();
    flushPersistence();
    expectEmptyCart();
    expect(getItem).toHaveBeenCalledTimes(1);
  });

  it('un snapshot expirado se borra sin hidratar al aparecer la tienda', () => {
    const snapshot = snapshotWithDelayedStore();
    writeSnapshot(snapshot, STORE_ID, Date.now() - 4 * 60 * 60 * 1000 - 1);
    userStore.set({ id: STORE_ID });
    TestBed.flushEffects();

    expectEmptyCart();
    expect(storage.getItem(KEY)).toBeNull();
    flushPersistence();
  });

  it('un snapshot expirado no se hidrata aunque el navegador rechace borrarlo', () => {
    const snapshot = snapshotWithDelayedStore();
    writeSnapshot(snapshot, STORE_ID, Date.now() - 4 * 60 * 60 * 1000 - 1);
    spyOn(Storage.prototype, 'removeItem').and.throwError('storage blocked');
    userStore.set({ id: STORE_ID });

    expect(() => TestBed.flushEffects()).not.toThrow();
    expectEmptyCart();
    expect(flushPersistence).not.toThrow();
  });

  it('rechaza un snapshot de otra tienda y reevalúa cuando cambia el signal de contexto', () => {
    const snapshot = snapshotWithDelayedStore();
    writeSnapshot(snapshot, STORE_ID + 1); // payload ajeno bajo la clave activa
    writeSnapshot(snapshot, STORE_ID + 1, Date.now(), OTHER_KEY);
    const getItem = spyOn(Storage.prototype, 'getItem').and.callThrough();
    userStore.set({ id: STORE_ID });
    TestBed.flushEffects();
    expectEmptyCart();

    userStore.set({ id: STORE_ID + 1 });
    TestBed.flushEffects();
    expect(service.currentState.items[0].id).toBe(snapshot.items[0].id);
    expect(getItem.calls.allArgs()).toEqual([[KEY], [OTHER_KEY]]);
    flushPersistence();
  });

  it('puede hidratar de nuevo al regresar a una tienda después de visitar otra', () => {
    const snapshot = snapshotWithDelayedStore();
    const otherSnapshot: PopCartState = {
      ...snapshot,
      items: [{ ...snapshot.items[0], id: 'other-item', product: { ...product, id: 2 } }],
    };
    writeSnapshot(snapshot);
    writeSnapshot(otherSnapshot, STORE_ID + 1, Date.now(), OTHER_KEY);
    const getItem = spyOn(Storage.prototype, 'getItem').and.callThrough();
    userStore.set({ id: STORE_ID });
    TestBed.flushEffects();
    expect(service.currentState.items[0].id).toBe(snapshot.items[0].id);

    service.clearCart().subscribe();
    writeSnapshot(snapshot); // snapshot disponible para la siguiente visita
    userStore.set({ id: STORE_ID + 1 });
    TestBed.flushEffects();
    expect(service.currentState.items[0].id).toBe('other-item');

    service.clearCart().subscribe();
    userStore.set({ id: STORE_ID });
    TestBed.flushEffects();
    expect(service.currentState.items[0].id).toBe(snapshot.items[0].id);
    expect(getItem.calls.allArgs()).toEqual([[KEY], [OTHER_KEY], [KEY]]);
    flushPersistence();
  });
});
