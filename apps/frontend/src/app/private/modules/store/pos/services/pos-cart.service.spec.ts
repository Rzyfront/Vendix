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
        // `PosCartService` inyecta `AuthFacade` (pos-cart.service.ts:89), que
        // a su vez inyecta el `Store` de NgRx. Sin este doble, el TestBed
        // instancia el facade real y muere con NG0201 antes de llegar a la
        // aserción. Mismo doble que ya usan los demás describes del archivo.
        { provide: AuthFacade, useValue: { userStore: () => ({ id: 1 }) } },
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
  let posApi: { updateOrderItems: jasmine.Spy; cancelOrder: jasmine.Spy };

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
      cancelOrder: jasmine.createSpy('cancelOrder').and.returnValue(of({ success: true })),
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
        // `PosCartService` inyecta `AuthFacade` (pos-cart.service.ts:89), que
        // a su vez inyecta el `Store` de NgRx. Sin este doble, el TestBed
        // instancia el facade real y muere con NG0201 antes de llegar a la
        // aserción. Mismo doble que ya usan los demás describes del archivo.
        { provide: AuthFacade, useValue: { userStore: () => ({ id: 1 }) } },
      ],
    });

    service = TestBed.inject(PosCartService);
  });

  it('clears a completed adopted sale locally without cancelling its paid order', (done) => {
    seedCart(500);
    service.clearCartAfterCompletedSale().subscribe((state) => {
      expect(posApi.cancelOrder).not.toHaveBeenCalled();
      expect(state.linkedOrderId).toBeNull();
      expect(state.items).toEqual([]);
      expect(service.cartState().linkedOrderId).toBeNull();
      done();
    });
  });

  it('still cancels an abandoned adopted cart when the cashier uses Vaciar', (done) => {
    seedCart(500);
    service.clearCart().subscribe((state) => {
      expect(posApi.cancelOrder).toHaveBeenCalledTimes(1);
      expect(state.linkedOrderId).toBeNull();
      done();
    });
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

/**
 * CP-pos-exclusive-tax-double-charge — C.8, tercera boca (2026-09-14).
 *
 * `processApplyTierToCartItem` pasaba `calculateRateSum(product)` (ciego a
 * `is_inclusive`) como `taxRate` a `PriceResolverService.resolveWithTier`,
 * que suma `unitPrice*(1+taxRate)` sin mirar si la tasa ya vive dentro del
 * precio. Con una tarifa de cliente fijando 15.000 sobre un producto con IVA/
 * INC INCLUIDO del 8 %, el resultado era `unitPrice` 15.000 (mal: la base
 * neta real es 13.888,89) y `unitPriceWithTax` 16.200 (mal: el bruto ya es
 * 15.000, no crece). El caso EXCLUSIVO (19 %) ya funcionaba bien y sirve de
 * regresión negativa.
 *
 * Se usa el `PriceResolverService` REAL (no un stub) porque no tiene
 * dependencias propias y es exactamente la pieza cuyo contrato con el nuevo
 * reparto neto/bruto hay que validar de punta a punta.
 */
describe('PosCartService — tarifa de cliente con impuesto incluido (C.8, tercera boca)', () => {
  let service: PosCartService;

  const buildTieredProduct = (
    taxAssignments: any[],
    productOverrides: Record<string, unknown> = {},
  ) =>
    ({
      id: 7001,
      name: 'Producto con tarifa Mayorista',
      sku: 'MAY-01',
      price: 20000, // base_price sin tarifa — irrelevante, la tarifa fija 15.000
      final_price: 20000,
      stock: 0,
      track_inventory: false,
      isActive: true,
      has_variants: false,
      has_multiple_price_tiers: true,
      enabled_price_tier_ids: [501],
      product_variants: [],
      tax_assignments: taxAssignments,
      ...productOverrides,
    }) as any;

  const mayoristaTier = { id: 501, name: 'Mayorista', discount_percentage: 0 } as any;
  const overrideAt15000 = [
    { variant_id: null, price_tier_id: 501, override_price: 15000, override_units_per_package: null },
  ] as any;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        PosCartService,
        PriceResolverService, // real: sin dependencias, es la pieza bajo prueba
        { provide: PosProductService, useValue: { getProductById: () => of(null) } },
        { provide: PosApiService, useValue: {} },
        {
          provide: PosSaleUnitService,
          useValue: {
            configFor: () => ({
              priceUnitQuantity: 1,
              unitsPerCapture: 1,
              captureUnit: null,
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

  it('IVA/INC INCLUIDO del 8%: la tarifa de 15.000 es el bruto — no crece, y la base neta despeja a 13.888,89', (done) => {
    const product = buildTieredProduct([
      {
        product_id: 7001,
        tax_category_id: 96,
        is_inclusive: true,
        tax_categories: {
          id: 96,
          name: 'INC',
          is_inclusive: true,
          tax_rates: [{ id: 68, rate: '0.08', is_inclusive: false }],
        },
      },
    ]);

    service.addToCart({ product, quantity: 1 }).subscribe((added) => {
      const itemId = added.items[0].id;
      service
        .applyTierToCartItem(itemId, mayoristaTier, overrideAt15000)
        .subscribe((state) => {
          const item = state.items[0];
          expect(item.finalPrice).toBe(15000);
          expect(item.unitPrice).toBe(13888.89);
          done();
        });
    });
  });

  it('IVA EXCLUSIVO del 19% (regresión): la tarifa de 15.000 sigue siendo la base neta y el bruto sube a 17.850', (done) => {
    const product = buildTieredProduct([
      {
        product_id: 7001,
        tax_category_id: 1,
        is_inclusive: false,
        tax_categories: {
          id: 1,
          name: 'IVA',
          is_inclusive: false,
          tax_rates: [{ id: 1, rate: '0.19', is_inclusive: false }],
        },
      },
    ]);

    service.addToCart({ product, quantity: 1 }).subscribe((added) => {
      const itemId = added.items[0].id;
      service
        .applyTierToCartItem(itemId, mayoristaTier, overrideAt15000)
        .subscribe((state) => {
          const item = state.items[0];
          expect(item.unitPrice).toBe(15000);
          expect(item.finalPrice).toBe(17850);
          done();
        });
    });
  });

  it('mixto — INC 8% incluido + IVA 19% adicional: el bruto de tarifa no se pierde y la base neta despeja sólo lo inclusivo', (done) => {
    // Sin casos reales hoy (QUI-832: 0 filas cruzan tarifa aplicada + impuesto
    // inclusivo en toda la base), pero la fórmula debe sostenerse si aparece.
    const product = buildTieredProduct([
      {
        product_id: 7001,
        tax_category_id: 96,
        is_inclusive: true,
        tax_categories: {
          id: 96,
          name: 'INC',
          is_inclusive: true,
          tax_rates: [{ id: 68, rate: '0.08', is_inclusive: false }],
        },
      },
      {
        product_id: 7001,
        tax_category_id: 1,
        is_inclusive: false,
        tax_categories: {
          id: 1,
          name: 'IVA',
          is_inclusive: false,
          tax_rates: [{ id: 1, rate: '0.19', is_inclusive: false }],
        },
      },
    ]);

    service.addToCart({ product, quantity: 1 }).subscribe((added) => {
      const itemId = added.items[0].id;
      service
        .applyTierToCartItem(itemId, mayoristaTier, overrideAt15000)
        .subscribe((state) => {
          const item = state.items[0];
          // netBase = 15.000 / 1.08 = 13.888,888... → 13.888,89
          expect(item.unitPrice).toBe(13888.89);
          // bruto = 15.000 (INC ya adentro) + 13.888,89 × 0,19 = 17.638,89
          expect(item.finalPrice).toBe(17638.89);
          done();
        });
    });
  });
});

/**
 * B5/B14 — oferta a nivel producto (2026-09-26).
 *
 * `pos-product.service.ts` sólo copiaba `is_on_sale`/`sale_price` en variantes
 * (línea ~740), nunca a nivel producto. `PriceResolverService.resolve()` nunca
 * entraba a su regla 3 (oferta) y el carrito cobraba `base_price`: la grilla
 * no mostraba el precio/etiqueta de oferta (B14) y el IVA se calculaba sobre
 * la base equivocada (B5). Caso del ticket: base 100.000, oferta 80.000, IVA
 * 19% EXCLUSIVO, `final_price` de catálogo 95.200 (= 80.000 × 1,19).
 *
 * Se usa el `PriceResolverService` REAL (mismo motivo que C.8 arriba): no
 * tiene dependencias propias y es la pieza cuyo contrato con `is_on_sale`
 * hay que validar de punta a punta, ahora que el producto lo trae poblado.
 */
describe('PosCartService — precio de oferta a nivel producto (B5/B14)', () => {
  let service: PosCartService;

  const saleProduct = (overrides: Record<string, unknown> = {}) =>
    ({
      id: 3301,
      name: 'Producto en oferta',
      sku: 'OFE-01',
      price: 100000, // base_price
      is_on_sale: true,
      sale_price: 80000,
      final_price: 95200, // catálogo: 80.000 × 1,19 (servidor, ya con IVA)
      stock: 0,
      track_inventory: false,
      isActive: true,
      has_variants: false,
      product_variants: [],
      tax_assignments: [
        {
          product_id: 3301,
          tax_category_id: 1,
          is_inclusive: false,
          tax_categories: {
            id: 1,
            name: 'IVA',
            is_inclusive: false,
            tax_rates: [{ id: 1, rate: '0.19', is_inclusive: false }],
          },
        },
      ],
      ...overrides,
    }) as any;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        PosCartService,
        PriceResolverService, // real: sin dependencias, es la pieza bajo prueba
        { provide: PosProductService, useValue: { getProductById: () => of(null) } },
        { provide: PosApiService, useValue: {} },
        {
          provide: PosSaleUnitService,
          useValue: {
            configFor: () => ({
              priceUnitQuantity: 1,
              unitsPerCapture: 1,
              captureUnit: null,
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

  it('cantidad 1 — cobra el precio de oferta, no la base, y el IVA sale de la oferta', (done) => {
    service.addToCart({ product: saleProduct(), quantity: 1 }).subscribe((state) => {
      const item = state.items[0];
      expect(item.unitPrice).toBe(80000);
      expect(item.taxAmount).toBe(15200);
      expect(item.finalPrice).toBe(95200);
      expect(item.totalPrice).toBe(95200);
      expect(state.summary.subtotal).toBe(80000);
      expect(state.summary.taxAmount).toBe(15200);
      expect(state.summary.total).toBe(95200);
      done();
    });
  });

  it('cantidad 3 — la oferta escala linealmente en subtotal, IVA y total', (done) => {
    service.addToCart({ product: saleProduct(), quantity: 3 }).subscribe((state) => {
      const item = state.items[0];
      expect(item.unitPrice).toBe(80000);
      expect(item.taxAmount).toBe(45600);
      expect(item.finalPrice).toBe(95200);
      expect(item.totalPrice).toBe(285600);
      expect(state.summary.subtotal).toBe(240000);
      expect(state.summary.taxAmount).toBe(45600);
      expect(state.summary.total).toBe(285600);
      done();
    });
  });
});

/**
 * F-225 (ADR-16, CP-pos-exclusive-tax-double-charge) — `isPriceOverridden`
 * decide en CENTAVOS ENTEROS, no en punto flotante.
 *
 * El gate viejo (`Math.abs(finalPrice - originalFinalPrice) >= 0.01`) resta
 * dos `number` en punto flotante: el MISMO centavo de diferencia cruza o no
 * el umbral según la magnitud de los dos precios. Medido en Node
 * (`money-compare.ts`, docblock de `differsByAtLeastCents`):
 *
 *   13603.13 − 13603.12 = 0.00999999999839...  ≥ 0.01 ? false  (NO dispara)
 *     551.06 −   551.05 = 0.00999999999999...  ≥ 0.01 ? false  (NO dispara)
 *       2425 −  2424.99 = 0.01000000000021...  ≥ 0.01 ? true   (dispara)
 *    2223.09 −  2223.08 = 0.01000000000021...  ≥ 0.01 ? true   (dispara)
 *
 * Los cuatro pares son el MISMO centavo real de diferencia. Con el gate
 * viejo, editar 13.603,13 → 13.603,12 (o 551,06 → 551,05) NO marcaba
 * `isPriceOverridden`, así que `final_unit_price` se omitía del payload de
 * cobro y el backend caía al precio de catálogo: la edición del cajero se
 * descartaba en silencio. Los cuatro casos deben dar el MISMO veredicto
 * (`true`): difieren en 1 centavo real, sin importar la magnitud.
 */
describe('PosCartService — isPriceOverridden en centavos enteros (F-225)', () => {
  let service: PosCartService;

  /** Producto simple sin impuesto: la aritmética de la línea no interfiere. */
  const flatProduct = (finalPrice: number) =>
    ({
      id: 'F225',
      name: 'Producto F-225',
      sku: 'F225',
      price: finalPrice,
      final_price: finalPrice,
      stock: 0,
      track_inventory: false,
      isActive: true,
      has_variants: false,
      product_variants: [],
      tax_assignments: [],
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

  const casosUnCentavoReal: Array<[number, number]> = [
    [13603.13, 13603.12],
    [551.06, 551.05],
    [2425.0, 2424.99],
    [2223.09, 2223.08],
  ];

  for (const [catalogo, editado] of casosUnCentavoReal) {
    it(`marca override con 1 centavo real de diferencia (${catalogo} → ${editado})`, (done) => {
      const product = flatProduct(catalogo);

      service.addToCart({ product, quantity: 1 }).subscribe((added) => {
        const itemId = added.items[0].id;
        expect(added.items[0].finalPrice).toBe(catalogo);

        service
          .updateCartItemPrice({ itemId, finalPrice: editado })
          .subscribe((state) => {
            expect(state.items[0].isPriceOverridden).toBe(true);
            done();
          });
      });
    });
  }

  it('NO marca override cuando el precio editado es idéntico al de catálogo', (done) => {
    const product = flatProduct(13603.13);

    service.addToCart({ product, quantity: 1 }).subscribe((added) => {
      const itemId = added.items[0].id;

      service
        .updateCartItemPrice({ itemId, finalPrice: 13603.13 })
        .subscribe((state) => {
          expect(state.items[0].isPriceOverridden).toBe(false);
          done();
        });
    });
  });
});

describe('PosCartService — updateCartItem preserva/borra notas por línea (paso 5)', () => {
  let service: PosCartService;

  const flatProduct = () =>
    ({
      id: 'NOTE5',
      name: 'Producto nota paso 5',
      sku: 'NOTE5',
      price: 1000,
      final_price: 1000,
      stock: 0,
      track_inventory: false,
      isActive: true,
      has_variants: false,
      product_variants: [],
      tax_assignments: [],
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

  it('borra la nota cuando el request trae la clave notes en undefined (Quitar nota)', (done) => {
    service.addToCart({ product: flatProduct(), quantity: 1 }).subscribe((added) => {
      const itemId = added.items[0].id;

      service
        .updateCartItem({ itemId, quantity: 1, notes: 'Sin cebolla' })
        .subscribe((withNote) => {
          expect(withNote.items[0].notes).toBe('Sin cebolla');

          service
            .updateCartItem({ itemId, quantity: 1, notes: undefined })
            .subscribe((cleared) => {
              expect(cleared.items[0].notes).toBeUndefined();
              done();
            });
        });
    });
  });

  it('preserva la nota cuando el request omite la clave notes (cambio solo-cantidad)', (done) => {
    service.addToCart({ product: flatProduct(), quantity: 1 }).subscribe((added) => {
      const itemId = added.items[0].id;

      service
        .updateCartItem({ itemId, quantity: 1, notes: 'Término medio' })
        .subscribe(() => {
          service
            .updateCartItem({ itemId, quantity: 2 })
            .subscribe((state) => {
              expect(state.items[0].quantity).toBe(2);
              expect(state.items[0].notes).toBe('Término medio');
              done();
            });
        });
    });
  });
});

/**
 * F-FLETE — `loadFromOrder` debe reponer `shippingContext`.
 *
 * `CartState.shippingContext` documentaba desde su nacimiento que lo poblaba
 * `loadFromOrder`; NADIE lo escribía (cero ocurrencias de `shipping`/`delivery`
 * en `pos-cart.service.ts`). Sin ese escritor, el carril vivo de edición
 * (`pos-checkout-shell.onUpdateEditor`) no tenía contra qué comparar y
 * reconstruía el envío desde cero: forzaba `delivery_type: 'pickup'` y dejaba
 * que el backend reseteara `shipping_cost` a 0 — cero que ENTRA al
 * `grand_total` (`orders.service.ts:2292`). Reabrir un borrador con flete
 * borraba el flete y el cajero leía "Orden actualizada correctamente".
 *
 * Invariantes que fija este bloque:
 *  1. Los seis campos del snapshot salen de la orden, con el valor exacto.
 *  2. El costo llega como Decimal de Prisma (string) y se normaliza a número
 *     SIN perder los centavos.
 *  3. Ausencia ≠ cero: una orden sin envío deja los ids y el costo en `null`
 *     (el editor trata la clave ausente como "sin cambio"; un 0 explícito
 *     BORRARÍA el flete).
 *  4. La rama de orden vacía también lo repone — si no, editar una orden sin
 *     líneas seguiría perdiendo el envío.
 */
describe('PosCartService — loadFromOrder repone shippingContext (flete del borrador)', () => {
  let service: PosCartService;
  let productService: any;

  const embeddedProduct = (id: number) => ({
    id: String(id),
    name: `Producto ${id}`,
    sku: `SKU-${id}`,
    price: 1000,
    final_price: 1190,
  });

  const buildItem = (productId: number) => ({
    product_id: productId,
    product_name: `Producto ${productId}`,
    quantity: 1,
    unit_price: 1000,
    final_unit_price: 1000,
    total_price: 1000,
    tax_amount_item: 190,
    products: embeddedProduct(productId),
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
        { provide: AuthFacade, useValue: { userStore: () => ({ id: 1 }) } },
      ],
    });

    service = TestBed.inject(PosCartService);
  });

  it('copia los seis campos del envío de la orden, con el costo Decimal en centavos exactos', (done) => {
    // Borrador `direct_delivery` con flete real: el caso que se perdía.
    const order = {
      id: 700,
      order_number: 'ORD202609190007',
      state: 'draft',
      delivery_type: 'direct_delivery',
      shipping_address_id: 33,
      billing_address_id: 44,
      shipping_method_id: 7,
      shipping_rate_id: 88,
      // Prisma Decimal → string en la respuesta HTTP.
      shipping_cost: '12500.50',
      order_items: [buildItem(1)],
    };

    service.loadFromOrder(order).subscribe((state) => {
      expect(state.shippingContext).toEqual({
        orderId: 700, customerId: null, shippingAddress: null, shippingMethod: null,
        deliveryType: 'direct_delivery',
        shippingAddressId: 33,
        billingAddressId: 44,
        shippingMethodId: 7,
        shippingRateId: 88,
        shippingCost: 12500.5,
      });
      done();
    });
  });

  it('deja ids y costo en null cuando la orden no tiene envío (ausencia ≠ cero)', (done) => {
    const order = {
      id: 701,
      order_number: 'ORD202609190008',
      state: 'created',
      delivery_type: 'pickup',
      shipping_address_id: null,
      billing_address_id: null,
      shipping_method_id: null,
      shipping_rate_id: null,
      shipping_cost: null,
      order_items: [buildItem(1)],
    };

    service.loadFromOrder(order).subscribe((state) => {
      expect(state.shippingContext).toEqual({
        orderId: 701, customerId: null, shippingAddress: null, shippingMethod: null,
        deliveryType: 'pickup',
        shippingAddressId: null,
        billingAddressId: null,
        shippingMethodId: null,
        shippingRateId: null,
        shippingCost: null,
      });
      done();
    });
  });

  it('repone el envío también en la rama de orden sin líneas', (done) => {
    const order = {
      id: 702,
      order_number: 'ORD202609190009',
      state: 'draft',
      delivery_type: 'home_delivery',
      shipping_address_id: 12,
      billing_address_id: null,
      shipping_method_id: 3,
      shipping_rate_id: null,
      shipping_cost: '8000.00',
      order_items: [],
    };

    service.loadFromOrder(order).subscribe((state) => {
      expect(state.items.length).toBe(0);
      expect(state.shippingContext).toEqual({
        orderId: 702, customerId: null, shippingAddress: null, shippingMethod: null,
        deliveryType: 'home_delivery',
        shippingAddressId: 12,
        billingAddressId: null,
        shippingMethodId: 3,
        shippingRateId: null,
        shippingCost: 8000,
      });
      done();
    });
  });

  it('hidrata la dirección no primaria de la orden con método y propietario originales', (done) => {
    const address = {
      id: 33, address_line1: 'Bodega secundaria 42', address_line2: 'Piso 2',
      city: 'Cali', state_province: 'Valle', country_code: 'CO', postal_code: '760001',
      phone_number: '3001234567', latitude: '3.45', longitude: '-76.5', municipality_code: '76001',
    };
    service.loadFromOrder({
      id: 703, customer_id: 99, users: { id: 99, first_name: 'Cliente',
        addresses: [{ id: 1, is_primary: true, address_line1: 'NO USAR' }] },
      order_items: [buildItem(1)], delivery_type: 'home_delivery',
      shipping_address_id: 33, shipping_method_id: 7, shipping_rate_id: 88,
      shipping_cost: '12500.50',
      addresses_orders_shipping_address_idToaddresses: address,
      shipping_method: { id: 7, name: 'Transportadora secundaria', type: 'carrier', is_active: true },
    }).subscribe((state) => {
      expect(state.shippingContext).toEqual(jasmine.objectContaining({
        orderId: 703, customerId: 99, shippingAddressId: 33, shippingRateId: 88,
        shippingCost: 12500.5,
        shippingMethod: { id: 7, name: 'Transportadora secundaria', type: 'carrier', is_active: true },
        shippingAddress: jasmine.objectContaining({ address_line1: address.address_line1, latitude: 3.45, longitude: -76.5, municipality_code: '76001' }),
      }));
      done();
    });
  });

  it('no usa la dirección primaria si falta la relación de dirección original', (done) => {
    service.loadFromOrder({
      id: 704, customer_id: 99, shipping_address_id: 33,
      users: { id: 99, first_name: 'Cliente', addresses: [{ id: 1, is_primary: true }] },
      order_items: [], shipping_method_id: 7, shipping_cost: 15000,
    }).subscribe((state) => {
      expect(state.shippingContext?.shippingAddress).toBeNull();
      expect(state.shippingContext?.shippingAddressId).toBe(33);
      done();
    });
  });

});
