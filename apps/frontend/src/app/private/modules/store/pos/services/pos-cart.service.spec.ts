import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { PosCartService } from './pos-cart.service';
import { PosProductService } from './pos-product.service';
import { PosApiService } from './pos-api.service';
import { PosSaleUnitService } from './pos-sale-unit.service';
import { PriceResolverService } from '../../../../../shared/services/pricing';
import { PriceTierCacheService } from '../../price-tiers/services/price-tier-cache.service';
import { WithholdingTaxService } from '../../withholding-tax/services/withholding-tax.service';
import { CurrencyFormatService } from '../../../../../shared/pipes/currency';
import { InvoicingService } from '../../invoicing/services/invoicing.service';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';

/**
 * CP-POS-CREAR-EDITAR-COBRAR-001 — G.1 / D.1
 *
 * `loadFromOrder` es el único camino de hidratación del editor POS. Sus
 * invariantes:
 *
 *  1. El snapshot embebido (`order_items[].products`) manda. Un GET por línea
 *     sería N+1 y puede vaciar el carrito si una petición falla.
 *  2. Sólo el producto genuinamente ausente dispara un fetch de respaldo.
 *  3. Si el respaldo tampoco lo resuelve, el error es TIPADO
 *     (`POS_PRODUCT_HYDRATION_FAILED`) — nunca un item stub silencioso que el
 *     cajero terminaría cobrando con precio/impuesto inventado.
 *  4. `linkedOrderId` / `linkedOrderNumber` sobreviven la carga: sin ellos el
 *     POS pierde contra qué orden está editando.
 */
describe('PosCartService — loadFromOrder (editor hydration)', () => {
  let service: PosCartService;
  // Cast del spy a `any`: jasmine.SpyObj<T> genera intersección con Spy<>
  // para CADA propiedad de T (incluidos signals WritableSignal que no son
  // funciones), y ng build --prod strict template checking rechaza la
  // intersección porque Spy<WritableSignal<T>> no existe. Mantenemos
  // tipado fuerte en los métodos usados abajo con `.and.returnValue(...)`.
  let productService: any;

  const embeddedProduct = (id: number) => ({
    id: String(id),
    name: `Producto ${id}`,
    sku: `SKU-${id}`,
    price: 1000,
    final_price: 1190,
  });

  const buildOrder = (items: any[]) => ({
    id: 500,
    order_number: 'ORD202608200001',
    notes: 'nota del cliente',
    users: { id: 99, first_name: 'Juan', last_name: 'Pérez' },
    order_promotions: [],
    coupon_uses: [],
    order_items: items,
  });

  const buildItem = (productId: number, embedded: any | null) => ({
    product_id: productId,
    product_name: `Producto ${productId}`,
    quantity: 2,
    unit_price: 1000,
    final_unit_price: 1000,
    total_price: 2000,
    tax_amount_item: 190,
    ...(embedded ? { products: embedded } : {}),
  });

  beforeEach(() => {
    productService = jasmine.createSpyObj<PosProductService>(
      'PosProductService',
      ['getProductById'],
    ) as unknown as jasmine.SpyObj<PosProductService>;

    TestBed.configureTestingModule({
      providers: [
        PosCartService,
        { provide: PosProductService, useValue: productService as unknown as PosProductService },
        { provide: PosApiService, useValue: {} },
        { provide: PosSaleUnitService, useValue: {} },
        { provide: PriceResolverService, useValue: {} },
        { provide: PriceTierCacheService, useValue: {} },
        {
          provide: WithholdingTaxService,
          useValue: {
            previewWithholding: () => of({ lines: [], total_withholding: 0 }),
          },
        },
        { provide: CurrencyFormatService, useValue: {} },
        {
          provide: InvoicingService,
          useValue: { getPosUvtThreshold: () => of({ data: null }) },
        },
      ],
    });

    service = TestBed.inject(PosCartService);
  });

  it('usa los productos embebidos y no dispara ningún GET por línea', (done) => {
    const order = buildOrder([
      buildItem(1, embeddedProduct(1)),
      buildItem(2, embeddedProduct(2)),
      buildItem(3, embeddedProduct(3)),
    ]);

    service.loadFromOrder(order).subscribe((state) => {
      expect(state.items.length).toBe(3);
      // La invariante que importa: cero peticiones. Un N+1 aquí es el bug que
      // D.1 vino a matar.
      expect(productService.getProductById).not.toHaveBeenCalled();
      expect(state.items[0].product.name).toBe('Producto 1');
      done();
    });
  });

  it('sólo pide los productos genuinamente ausentes', (done) => {
    productService.getProductById.and.returnValue(
      of(embeddedProduct(2) as any),
    );

    const order = buildOrder([
      buildItem(1, embeddedProduct(1)),
      buildItem(2, null), // ← sin snapshot embebido
      buildItem(3, embeddedProduct(3)),
    ]);

    service.loadFromOrder(order).subscribe((state) => {
      expect(state.items.length).toBe(3);
      expect(productService.getProductById).toHaveBeenCalledTimes(1);
      expect(productService.getProductById).toHaveBeenCalledWith('2');
      done();
    });
  });

  it('propaga un error tipado cuando el producto faltante tampoco se puede traer', (done) => {
    productService.getProductById.and.returnValue(
      throwError(() => new Error('network down')),
    );

    const order = buildOrder([buildItem(7, null)]);

    service.loadFromOrder(order).subscribe({
      next: () => done.fail('no debe emitir un carrito con un item stub'),
      error: (err: any) => {
        // Error tipado, no un stub silencioso con precio inventado.
        expect(err.errorCode).toBe('POS_PRODUCT_HYDRATION_FAILED');
        expect(err.details.missing_product_ids).toContain('7');
        expect(typeof err.message).toBe('string');
        expect(err.message.length).toBeGreaterThan(0);
        done();
      },
    });
  });

  it('restaura linkedOrderId, linkedOrderNumber, cliente y notas', (done) => {
    const order = buildOrder([buildItem(1, embeddedProduct(1))]);

    service.loadFromOrder(order).subscribe((state) => {
      expect(state.linkedOrderId).toBe(500);
      expect(state.linkedOrderNumber).toBe('ORD202608200001');
      expect(state.notes).toBe('nota del cliente');
      // El cliente sale de `order.users`, nunca del default del carrito.
      expect(state.customer).toBeTruthy();
      expect(String(state.customer!.id)).toBe('99');
      done();
    });
  });

  it('conserva el contexto de la orden incluso cuando la orden llega sin items', (done) => {
    service.loadFromOrder(buildOrder([])).subscribe((state) => {
      expect(state.items.length).toBe(0);
      expect(state.linkedOrderId).toBe(500);
      expect(state.linkedOrderNumber).toBe('ORD202608200001');
      expect(productService.getProductById).not.toHaveBeenCalled();
      done();
    });
  });
});

/**
 * `removeFromCart` en modo adoptado: el servidor es la fuente de verdad
 * (doctrina QUI-649, paridad con `addToCart`). El mutar-solo-local mostraba
 * toast de éxito pero la línea sobrevivía en el backend y reaparecía al
 * resincronizar — el "no me deja eliminar" del POS.
 */
describe('PosCartService — removeFromCart (modo adoptado)', () => {
  let service: PosCartService;
  let posApi: { updateOrderItems: jasmine.Spy };

  const embeddedProduct = (id: number) => ({
    id: String(id),
    name: `Producto ${id}`,
    sku: `SKU-${id}`,
    price: 1000,
    final_price: 1000,
  });

  const cartLine = (id: string, productId: number) =>
    ({
      id,
      product: { id: String(productId), name: `Producto ${productId}` },
      quantity: 1,
      unitPrice: 1000,
      finalPrice: 1000,
      totalPrice: 1000,
      taxAmount: 0,
      itemType: 'product',
      addedAt: new Date(),
    }) as any;

  const seedCart = (linkedOrderId: number | null) => {
    service.cartState.set({
      ...service.cartState(),
      linkedOrderId,
      linkedOrderNumber: linkedOrderId != null ? 'ORD1' : null,
      items: [cartLine('a', 1), cartLine('b', 2)],
    });
  };

  beforeEach(() => {
    posApi = {
      updateOrderItems: jasmine.createSpy('updateOrderItems'),
    };

    TestBed.configureTestingModule({
      providers: [
        PosCartService,
        { provide: PosProductService, useValue: { getProductById: () => of(null) } },
        { provide: PosApiService, useValue: posApi },
        { provide: PosSaleUnitService, useValue: {} },
        { provide: PriceResolverService, useValue: {} },
        { provide: PriceTierCacheService, useValue: {} },
        {
          provide: WithholdingTaxService,
          useValue: {
            previewWithholding: () => of({ lines: [], total_withholding: 0 }),
          },
        },
        { provide: CurrencyFormatService, useValue: {} },
        {
          provide: InvoicingService,
          useValue: { getPosUvtThreshold: () => of({ data: null }) },
        },
      ],
    });

    service = TestBed.inject(PosCartService);
  });

  it('en modo adoptado envía la lista restante por PUT y resincroniza', (done) => {
    seedCart(500);
    posApi.updateOrderItems.and.returnValue(
      of({
        id: 500,
        order_number: 'ORD1',
        users: { id: 99, first_name: 'Juan', last_name: 'Pérez' },
        order_promotions: [],
        coupon_uses: [],
        order_items: [
          {
            product_id: 2,
            product_name: 'Producto 2',
            quantity: 1,
            unit_price: 1000,
            final_unit_price: 1000,
            total_price: 1000,
            tax_amount_item: 0,
            products: embeddedProduct(2),
          },
        ],
      }),
    );

    service.removeFromCart('a').subscribe((state) => {
      expect(posApi.updateOrderItems).toHaveBeenCalledTimes(1);
      const [orderId, payload] =
        posApi.updateOrderItems.calls.mostRecent().args;
      expect(orderId).toBe(500);
      expect(payload.length).toBe(1);
      expect(payload[0].product_id).toBe(2);
      expect(state.items.length).toBe(1);
      expect(state.linkedOrderId).toBe(500);
      done();
    });
  });

  it('en modo local no toca el backend', (done) => {
    seedCart(null);

    service.removeFromCart('a').subscribe((state) => {
      expect(posApi.updateOrderItems).not.toHaveBeenCalled();
      expect(state.items.length).toBe(1);
      expect(state.items[0].id).toBe('b');
      done();
    });
  });
});

/**
 * QUI-806 — el último producto del carrito no se vacía al eliminarlo.
 *
 * Síntoma reportado: en /admin/pos, al agregar 1 producto y pulsar
 * "Eliminar", el toast decía "Producto eliminado" pero la línea seguía
 * visible con su cantidad.
 *
 * Causa raíz (race condition): el effect de hidratación de carrito
 * (`initPersistence`) leía `cartState().items.length` DENTRO de su cuerpo
 * para hacer el guard "no pisar un carrito activo". Angular registraba
 * esa lectura como dependencia del effect, así que se re-evaluaba con
 * cada add/remove. La secuencia problemática era:
 *   1. Usuario elimina el último producto.
 *   2. `cartState.set({items: []})` re-evalúa el effect SINCRONAMENTE.
 *   3. `items.length === 0` → entra a la rama de hidratación.
 *   4. `loadFromStorage()` lee el valor PREVIO de localStorage
 *      (el debounce de 250ms del save aún no disparó).
 *   5. `cartState.set(saved)` restaura el item eliminado.
 *   6. 250ms después, `saveToStorage` persiste el item restaurado.
 *
 * Fix: el guard interno se mantiene (sigue siendo importante no pisar un
 * carrito activo al cambiar de tienda), pero la lectura se envuelve en
 * `untracked()` para que NO sea dependencia del effect. El effect
 * ahora solo re-dispara cuando cambia la tienda activa.
 */
describe('PosCartService — removeFromCart (modo libre, QUI-806)', () => {
  let service: PosCartService;

  const cartLine = (id: string) =>
    ({
      id,
      product: { id: id, name: `Item ${id}` },
      quantity: 1,
      unitPrice: 1000,
      finalPrice: 1000,
      totalPrice: 1000,
      taxAmount: 0,
      itemType: 'product',
      addedAt: new Date(),
    }) as any;

  const seedCartWithOneItem = () => {
    service.cartState.set({
      ...service.cartState(),
      linkedOrderId: null,
      linkedOrderNumber: null,
      items: [cartLine('only-item')],
    });
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        PosCartService,
        { provide: PosProductService, useValue: { getProductById: () => of(null) } },
        { provide: PosApiService, useValue: {} },
        { provide: PosSaleUnitService, useValue: {} },
        { provide: PriceResolverService, useValue: {} },
        { provide: PriceTierCacheService, useValue: {} },
        {
          provide: WithholdingTaxService,
          useValue: {
            previewWithholding: () => of({ lines: [], total_withholding: 0 }),
          },
        },
        { provide: CurrencyFormatService, useValue: {} },
        {
          provide: InvoicingService,
          useValue: { getPosUvtThreshold: () => of({ data: null }) },
        },
        { provide: AuthFacade, useValue: { userStore: () => ({ id: 1 }) } },
      ],
    });
    service = TestBed.inject(PosCartService);
  });

  it('vacía el carrito al eliminar el único producto (modo libre)', (done) => {
    seedCartWithOneItem();
    expect(service.cartState().items.length).toBe(1);

    service.removeFromCart('only-item').subscribe((state) => {
      // El cart DEBE quedar vacío tras eliminar el único item.
      expect(state.items.length).toBe(0);
      expect(service.cartIsEmpty()).toBe(true);
      done();
    });
  });
});

/**
 * C.6 CP-pos-exclusive-tax-double-charge — el subtotal del resumen compone
 * la base NETA recibida (`unitPrice` neto × `lineUnits`), nunca
 * `grossTotal − taxAmount` (celda 4 de la matriz: con truncado DIAN la
 * resta no es exacta y deja un residuo huérfano entre Subtotal e IVA).
 *
 * PENDIENTE DE CORRER: `ng test` exige ChromeHeadless y esta máquina no
 * tiene binario de Chrome (`which chrome` vacío). Comando para Rafael, desde
 * `apps/frontend`: `npx ng test --watch=false
 * --browsers=ChromeHeadlessNoSandbox --include` apuntando a este spec.
 * (El glob no se escribe aquí: la secuencia de cierre de comentario que
 * lleva dentro termina el bloque y el resto se compila como código.)
 */
describe('PosCartService — calculateSummary base neta (C.6)', () => {
  let service: PosCartService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        PosCartService,
        { provide: PosProductService, useValue: {} },
        { provide: PosApiService, useValue: {} },
        { provide: PosSaleUnitService, useValue: {} },
        { provide: PriceResolverService, useValue: {} },
        { provide: PriceTierCacheService, useValue: {} },
        {
          provide: WithholdingTaxService,
          useValue: {
            previewWithholding: () => of({ lines: [], total_withholding: 0 }),
          },
        },
        { provide: CurrencyFormatService, useValue: {} },
        {
          provide: InvoicingService,
          useValue: { getPosUvtThreshold: () => of({ data: null }) },
        },
        { provide: AuthFacade, useValue: { userStore: () => ({ id: 1 }) } },
      ],
    });
    service = TestBed.inject(PosCartService);
  });

  const orderWith = (items: any[]) => ({
    id: 502,
    order_number: 'ORD-C6-001',
    notes: '',
    users: { id: 99, first_name: 'Juan', last_name: 'Pérez' },
    order_promotions: [],
    coupon_uses: [],
    order_items: items,
  });

  const adopted = {
    id: '1',
    name: 'Producto 1',
    sku: 'SKU-1',
    price: 1000,
    final_price: 1000,
  };

  it('el subtotal es la base neta (unit × qty), no el bruto menos impuesto', (done) => {
    // Base 1000 × 2 = 2000. La resta vieja daba 2000 − 380 = 1620 por el
    // mapeo `tax_amount_item × quantity` (doble conteo ajeno a C.6).
    const order = orderWith([
      {
        product_id: 1,
        product_name: 'Producto 1',
        quantity: 2,
        unit_price: 1000,
        final_unit_price: 1000,
        total_price: 2000,
        tax_amount_item: 190,
        products: adopted,
      },
    ]);

    service.loadFromOrder(order).subscribe((state) => {
      expect(state.summary.subtotal).toBe(2000);
      done();
    });
  });

  it('con impuesto en cero el subtotal coincide con el bruto', (done) => {
    const order = orderWith([
      {
        product_id: 2,
        product_name: 'Producto 2',
        quantity: 1,
        unit_price: 5000,
        final_unit_price: 5000,
        total_price: 5000,
        tax_amount_item: 0,
        products: { ...adopted, id: '2', name: 'Producto 2' },
      },
    ]);

    service.loadFromOrder(order).subscribe((state) => {
      expect(state.summary.subtotal).toBe(5000);
      done();
    });
  });
});

/**
 * Impuesto INCLUIDO en el precio publicado — el carrito no puede volver a
 * sumarlo (caso de producción: store 105 "Pollo Arabe", producto 4258
 * "1/4 de Pollo", 14-sep-2026).
 *
 * SÍNTOMA: el cajero tocaba dos veces la tarjeta del mismo producto y el
 * cobro respondía HTTP 400 `POS_PRICE_OVERRIDE_NOT_ALLOWED_001` — "El
 * producto no permite editar el precio en POS" — sin que nadie hubiera
 * editado un precio.
 *
 * CAUSA: `processAddToCart` tiene dos ramas y sólo una tomaba el precio del
 * servidor. La de ALTA sin variante usaba `product.final_price` (ya resuelto
 * por el backend con `is_inclusive`), pero la de MERGE —y la de alta CON
 * variante— recalculaban con `calculateItemFinalPriceWithBase`, que multiplica
 * por `1 + calculateRateSum(product)`. `calculateRateSum` suma las tasas sin
 * mirar `is_inclusive` ni una vez, así que con INC 8 % incluido la línea
 * pasaba de 18.500 a 19.980: el impuesto que ya venía DENTRO del precio se
 * sumaba una segunda vez, en el cliente.
 *
 * POR QUÉ TERMINABA EN UN 400: el POS manda ese número como
 * `final_unit_price`. `payments.service.ts` (`buildPosOrderItem`) reconstruye
 * el precio de catálogo (18.500), ve una diferencia de 1.480 ≥ 0,01, lo
 * clasifica como override manual y, con `allow_pos_price_override = false`,
 * rechaza el cobro. El guard del backend estaba bien; el dato que llegaba
 * estaba mal.
 *
 * ALCANCE REAL EN PROD: desde que nació la asignación INC (12-sep-2026) no
 * existía UNA SOLA línea `POS-xxxx` con `quantity >= 2` en esa tienda. El
 * defecto bloqueaba el 100 % de las ventas POS con producto repetido.
 *
 * POR QUÉ LA SUITE PASABA EN VERDE: ningún test agregaba dos veces el mismo
 * producto con `is_inclusive = true`. De ahí este bloque.
 *
 * PENDIENTE DE CORRER: `ng test` exige ChromeHeadless y esta máquina no tiene
 * binario de Chrome. Estos casos los verifica CI.
 */
describe('PosCartService — precio con impuesto incluido al repetir producto', () => {
  let service: PosCartService;

  /**
   * Espejo del producto real: precio publicado 18.500 con INC 8 % INCLUIDO.
   * `final_price` es lo que devuelve el backend (`resolveLineTotals`): con
   * impuesto incluido NO crece, por eso vale lo mismo que `price`.
   */
  const inclusiveProduct = () =>
    ({
      id: '4258',
      name: '1/4 de Pollo',
      sku: 'PA54',
      price: 18500,
      final_price: 18500,
      stock: 0,
      track_inventory: false,
      isActive: true,
      has_variants: false,
      product_variants: [],
      tax_assignments: [
        {
          product_id: 4258,
          tax_category_id: 96,
          is_inclusive: true,
          tax_categories: {
            id: 96,
            name: 'INC',
            tax_type: 'inc',
            is_inclusive: true,
            // La fila de la TASA dice lo contrario que la asignación; la
            // precedencia canónica (asignación > categoría > tasa) hace ganar
            // a la asignación, igual que en `final-price.util.ts` del backend.
            tax_rates: [{ id: 68, rate: '0.08', is_inclusive: false }],
          },
        },
      ],
    }) as any;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        PosCartService,
        { provide: PosProductService, useValue: { getProductById: () => of(null) } },
        { provide: PosApiService, useValue: {} },
        {
          provide: PosSaleUnitService,
          useValue: {
            // Producto por pieza: toda la aritmética colapsa a la histórica.
            configFor: () => ({
              priceUnitQuantity: 1,
              unitsPerCapture: 1,
              captureUnit: null,
            }),
          },
        },
        {
          provide: PriceResolverService,
          useValue: {
            resolve: (product: any, variant?: any) => ({
              unitPrice: Number(
                variant?.price_override ?? product?.base_price ?? 0,
              ),
            }),
          },
        },
        { provide: PriceTierCacheService, useValue: {} },
        {
          provide: WithholdingTaxService,
          useValue: {
            previewWithholding: () => of({ lines: [], total_withholding: 0 }),
          },
        },
        { provide: CurrencyFormatService, useValue: {} },
        {
          provide: InvoicingService,
          useValue: { getPosUvtThreshold: () => of({ data: null }) },
        },
        { provide: AuthFacade, useValue: { userStore: () => ({ id: 1 }) } },
      ],
    });
    service = TestBed.inject(PosCartService);
  });

  it('repetir la tarjeta del producto no le suma el impuesto ya incluido', (done) => {
    const product = inclusiveProduct();

    service.addToCart({ product, quantity: 1 }).subscribe((first) => {
      // Alta: el precio sale del servidor, intacto.
      expect(first.items.length).toBe(1);
      expect(first.items[0].finalPrice).toBe(18500);

      // Segunda pulsación de la MISMA tarjeta: la línea se fusiona.
      service.addToCart({ product, quantity: 1 }).subscribe((merged) => {
        expect(merged.items.length).toBe(1);
        expect(merged.items[0].quantity).toBe(2);
        // La invariante: el precio unitario NO cambia por fusionar. 19.980
        // era el defecto (18.500 × 1,08) y es lo que disparaba el 400.
        expect(merged.items[0].finalPrice).toBe(18500);
        expect(merged.items[0].totalPrice).toBe(37000);
        done();
      });
    });
  });

  it('la variante toma su propio final_price desde el primer agregado', (done) => {
    // La rama de alta CON variante usaba la misma función defectuosa, así que
    // un producto con variantes e impuesto incluido rompía sin repetir nada.
    const product = { ...inclusiveProduct(), has_variants: true };
    const variant = {
      id: 991,
      sku: 'PA54-G',
      price_override: 18500,
      final_price: 18500,
      stock: 0,
      track_inventory_override: false,
    } as any;

    service.addToCart({ product, quantity: 1, variant }).subscribe((state) => {
      expect(state.items.length).toBe(1);
      expect(state.items[0].finalPrice).toBe(18500);
      done();
    });
  });

  it('sin final_price del servidor sigue valiendo la aritmética local para tasa agregada', (done) => {
    // Respaldo, no camino feliz: si el payload no trae `final_price`, la tasa
    // EXCLUSIVA debe seguir sumándose o la línea se cobraría de menos.
    const product = {
      ...inclusiveProduct(),
      id: '9001',
      name: 'Producto con IVA agregado',
      price: 10000,
      final_price: null,
      tax_assignments: [
        {
          product_id: 9001,
          tax_category_id: 1,
          is_inclusive: false,
          tax_categories: {
            id: 1,
            name: 'IVA',
            tax_type: 'iva',
            is_inclusive: false,
            tax_rates: [{ id: 1, rate: '0.19', is_inclusive: false }],
          },
        },
      ],
    } as any;

    service.addToCart({ product, quantity: 1 }).subscribe((state) => {
      expect(state.items[0].finalPrice).toBe(11900);
      done();
    });
  });
});
