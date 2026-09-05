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
