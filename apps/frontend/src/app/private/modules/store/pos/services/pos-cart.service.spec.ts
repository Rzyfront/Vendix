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
  let productService: jasmine.SpyObj<PosProductService>;

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
    );

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
