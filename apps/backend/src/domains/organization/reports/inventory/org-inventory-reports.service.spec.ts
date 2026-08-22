import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';

import { OrgInventoryReportsService } from './org-inventory-reports.service';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { OrganizationPrismaService } from '../../../../prisma/services/organization-prisma.service';
import { OperatingScopeService } from '@common/services/operating-scope.service';
import { RequestContextService } from '@common/context/request-context.service';
import { CostingMethodResolverService } from '../../../store/inventory/shared/services/costing-method-resolver.service';

/**
 * D-8.3 (P0) — la valuación se firmaba «autoritativa» sin cubrir el inventario.
 *
 * El único control era `layers.length === 0`: bastaba UNA capa de costo viva
 * para que el informe valorara sólo lo que tenía capa y firmara el total como
 * definitivo. Una organización con $120M en bodega recibía un informe de
 * $40.000 marcado `is_authoritative: true`, sin insignia de parcial.
 *
 * El camino de promedio ponderado tenía el mismo agujero por otra vía: filtra
 * `cost_per_unit: { not: null }`, así que el stock sin costo unitario
 * desaparecía del total en silencio en vez de aportar $0 visible.
 *
 * Estos casos afirman que la cobertura se MIDE (unidades valoradas contra
 * unidades físicas) y que `is_authoritative` se deriva de ella.
 */
describe('OrgInventoryReportsService — cobertura de costo', () => {
  let service: OrgInventoryReportsService;
  let prisma: {
    stock_levels: { findMany: jest.Mock; aggregate: jest.Mock };
  };
  let costingResolver: { resolveCostingMethod: jest.Mock };

  const ORG_ID = 7;

  /** Fila de stock con costo: entra al total y cuenta como cubierta. */
  const filaConCosto = (onHand: number, costo: number, storeId = 10) => ({
    quantity_on_hand: onHand,
    cost_per_unit: new Prisma.Decimal(costo),
    inventory_locations: { store_id: storeId },
  });

  beforeEach(async () => {
    prisma = {
      stock_levels: { findMany: jest.fn(), aggregate: jest.fn() },
    };
    costingResolver = { resolveCostingMethod: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrgInventoryReportsService,
        { provide: GlobalPrismaService, useValue: prisma },
        {
          provide: OrganizationPrismaService,
          useValue: { getScopedWhere: jest.fn().mockResolvedValue({}) },
        },
        {
          provide: OperatingScopeService,
          useValue: {
            requireOperatingScope: jest.fn().mockResolvedValue('ORGANIZATION'),
          },
        },
        { provide: CostingMethodResolverService, useValue: costingResolver },
      ],
    }).compile();

    service = module.get(OrgInventoryReportsService);

    jest
      .spyOn(RequestContextService, 'getOrganizationId')
      .mockReturnValue(ORG_ID);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('promedio ponderado', () => {
    it('EL DEFECTO: stock sin costo unitario ya no se descarta en silencio', async () => {
      costingResolver.resolveCostingMethod.mockResolvedValue(
        'weighted_average',
      );
      // Sólo 100 de las 1.000 unidades físicas tienen costo registrado.
      prisma.stock_levels.findMany.mockResolvedValue([
        filaConCosto(100, 400),
      ]);
      prisma.stock_levels.aggregate.mockResolvedValue({
        _sum: { quantity_on_hand: 1000 },
      });

      const res = await service.getValuationSnapshot({});

      expect(res.total_value).toBe(40000);
      // Antes: is_authoritative implícito, sin cobertura. Ahora:
      expect(res.is_authoritative).toBe(false);
      expect(res.partial_data).toBe(true);
      expect(res.cost_coverage).toEqual({
        units_total: 1000,
        units_without_cost: 900,
        coverage_ratio: 0.1,
      });
      expect(res.note).toContain('SUBESTIMADO');
    });

    it('firma autoritativa sólo cuando la cobertura alcanza el físico', async () => {
      costingResolver.resolveCostingMethod.mockResolvedValue(
        'weighted_average',
      );
      prisma.stock_levels.findMany.mockResolvedValue([
        filaConCosto(600, 100),
        filaConCosto(400, 50),
      ]);
      prisma.stock_levels.aggregate.mockResolvedValue({
        _sum: { quantity_on_hand: 1000 },
      });

      const res = await service.getValuationSnapshot({});

      expect(res.is_authoritative).toBe(true);
      expect(res.partial_data).toBe(false);
      expect(res.cost_coverage.units_without_cost).toBe(0);
      expect(res.cost_coverage.coverage_ratio).toBe(1);
      expect(res.note).toContain('autoritativa');
    });

    it('tolera 1 unidad de descuadre para no marcar parcial por un redondeo', async () => {
      costingResolver.resolveCostingMethod.mockResolvedValue(
        'weighted_average',
      );
      prisma.stock_levels.findMany.mockResolvedValue([filaConCosto(999, 100)]);
      prisma.stock_levels.aggregate.mockResolvedValue({
        _sum: { quantity_on_hand: 1000 },
      });

      const res = await service.getValuationSnapshot({});

      expect(res.cost_coverage.units_without_cost).toBe(1);
      expect(res.is_authoritative).toBe(true);
      expect(res.partial_data).toBe(false);
    });

    it('marca parcial a partir de 2 unidades sin costo', async () => {
      costingResolver.resolveCostingMethod.mockResolvedValue(
        'weighted_average',
      );
      prisma.stock_levels.findMany.mockResolvedValue([filaConCosto(998, 100)]);
      prisma.stock_levels.aggregate.mockResolvedValue({
        _sum: { quantity_on_hand: 1000 },
      });

      const res = await service.getValuationSnapshot({});

      expect(res.cost_coverage.units_without_cost).toBe(2);
      expect(res.is_authoritative).toBe(false);
      expect(res.partial_data).toBe(true);
    });

    it('sin stock físico no hay nada que subestimar: cobertura completa', async () => {
      costingResolver.resolveCostingMethod.mockResolvedValue(
        'weighted_average',
      );
      prisma.stock_levels.findMany.mockResolvedValue([]);
      prisma.stock_levels.aggregate.mockResolvedValue({
        _sum: { quantity_on_hand: null },
      });

      const res = await service.getValuationSnapshot({});

      expect(res.total_value).toBe(0);
      expect(res.cost_coverage.units_total).toBe(0);
      expect(res.cost_coverage.coverage_ratio).toBe(1);
      expect(res.is_authoritative).toBe(true);
    });

    it('nunca reporta cobertura negativa aunque lo valorado exceda el agregado', async () => {
      // Puede pasar si el agregado y el detalle se leen con microsegundos de
      // diferencia. La cobertura se satura en 0 sin costo, no en negativo.
      costingResolver.resolveCostingMethod.mockResolvedValue(
        'weighted_average',
      );
      prisma.stock_levels.findMany.mockResolvedValue([filaConCosto(1200, 10)]);
      prisma.stock_levels.aggregate.mockResolvedValue({
        _sum: { quantity_on_hand: 1000 },
      });

      const res = await service.getValuationSnapshot({});

      expect(res.cost_coverage.units_without_cost).toBe(0);
      expect(res.is_authoritative).toBe(true);
    });
  });

  describe('contexto', () => {
    it('sin organización en contexto no entrega cifras', async () => {
      jest
        .spyOn(RequestContextService, 'getOrganizationId')
        .mockReturnValue(undefined as unknown as number);

      await expect(service.getValuationSnapshot({})).rejects.toThrow(
        'Organization context required',
      );
    });
  });
});

/**
 * CP-PURCHASE-TRANSPARENCY D.3 — el universo agregado excluye archivados.
 *
 * EL DEFECTO QUE CIERRA
 * ---------------------
 * Archivar un producto nunca borró sus filas de `stock_levels`. D.2 sacó esas
 * unidades del motor de COSTEO; este servicio las seguía REPORTANDO como
 * existencia real. Medido en la base local (organización 6): 2.333.553 de
 * valor en 50 filas sobre 25 productos archivados, dentro del total del
 * informe de valuación.
 *
 * LO QUE ESTOS CASOS FIJAN
 * ------------------------
 * Los SEIS puntos de lectura agregada emiten el predicado, con el nombre de
 * relación que el esquema declara —`products`, PLURAL, tanto en `stock_levels`
 * como en `inventory_cost_layers`— y no una analogía copiada de
 * `inventory_valuation_snapshots`, donde la relación se llama `product`.
 *
 * Y fijan la otra mitad: el valor archivado NO se evapora, sale por su propio
 * campo para que el frontend pueda decir a dónde se fue.
 */
describe('OrgInventoryReportsService — el archivado sale del agregado (D.3)', () => {
  /**
   * El predicado literal, escrito a mano y no importado del servicio a
   * propósito: si alguien cambia la constante compartida, estos casos tienen
   * que RUIDO, no adaptarse en silencio.
   *
   * `products` en PLURAL. Verificado en `schema.prisma`:
   * `stock_levels { ... products products @relation(...) }` e
   * `inventory_cost_layers { ... products products @relation(...) }`.
   */
  const FILTRO_ACTIVO = { products: { state: { not: 'archived' } } };
  const FILTRO_ARCHIVADO = { products: { state: 'archived' } };

  let service: OrgInventoryReportsService;
  let prisma: any;
  let orgPrisma: any;
  let costingResolver: { resolveCostingMethod: jest.Mock };

  const ORG_ID = 6;

  const filaConCosto = (onHand: number, costo: number, storeId = 10) => ({
    quantity_on_hand: onHand,
    cost_per_unit: new Prisma.Decimal(costo),
    inventory_locations: { store_id: storeId },
  });

  beforeEach(async () => {
    prisma = {
      stock_levels: {
        findMany: jest.fn().mockResolvedValue([]),
        aggregate: jest.fn().mockResolvedValue({
          _sum: {
            quantity_on_hand: 0,
            quantity_reserved: 0,
            quantity_available: 0,
          },
          _count: { _all: 0 },
        }),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      inventory_locations: {
        count: jest.fn().mockResolvedValue(3),
        findMany: jest.fn().mockResolvedValue([]),
      },
      stores: { findMany: jest.fn().mockResolvedValue([]) },
    };
    orgPrisma = {
      getScopedWhere: jest.fn().mockResolvedValue({}),
      inventory_cost_layers: { findMany: jest.fn().mockResolvedValue([]) },
    };
    costingResolver = {
      resolveCostingMethod: jest.fn().mockResolvedValue('weighted_average'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrgInventoryReportsService,
        { provide: GlobalPrismaService, useValue: prisma },
        { provide: OrganizationPrismaService, useValue: orgPrisma },
        {
          provide: OperatingScopeService,
          useValue: {
            requireOperatingScope: jest.fn().mockResolvedValue('ORGANIZATION'),
          },
        },
        { provide: CostingMethodResolverService, useValue: costingResolver },
      ],
    }).compile();

    service = module.get(OrgInventoryReportsService);
    jest
      .spyOn(RequestContextService, 'getOrganizationId')
      .mockReturnValue(ORG_ID);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('punto 1/6 — resumen de stock', () => {
    it('el agregado y el conteo de productos distintos excluyen archivados', async () => {
      await service.getStockSummary({});

      const [agregadoActivo] = prisma.stock_levels.aggregate.mock.calls[0];
      expect(agregadoActivo.where).toEqual(
        expect.objectContaining(FILTRO_ACTIVO),
      );

      const [distintos] = prisma.stock_levels.findMany.mock.calls[0];
      expect(distintos.where).toEqual(expect.objectContaining(FILTRO_ACTIVO));
    });

    it('las ubicaciones NO se filtran: una bodega existe aunque lo que guarde esté archivado', async () => {
      await service.getStockSummary({});

      const [ubicaciones] = prisma.inventory_locations.count.mock.calls[0];
      expect(ubicaciones.where).not.toHaveProperty('products');
    });

    it('devuelve las unidades archivadas por su propio campo, no las esconde', async () => {
      prisma.stock_levels.aggregate
        .mockResolvedValueOnce({
          _sum: {
            quantity_on_hand: 15763417,
            quantity_reserved: 69043,
            quantity_available: 15693379,
          },
          _count: { _all: 208 },
        })
        .mockResolvedValueOnce({
          _sum: { quantity_on_hand: 1756346 },
          _count: { _all: 50 },
        });

      const res = await service.getStockSummary({});

      expect(res.total_quantity_on_hand).toBe(15763417);
      expect(res.archived_stock_units).toBe(1756346);
      expect(res.archived_skus).toBe(50);

      const [agregadoArchivado] = prisma.stock_levels.aggregate.mock.calls[1];
      expect(agregadoArchivado.where).toEqual(
        expect.objectContaining(FILTRO_ARCHIVADO),
      );
    });
  });

  describe('punto 2/6 — stock por tienda', () => {
    it('el groupBy excluye archivados', async () => {
      await service.getStockByStore({});

      const [args] = prisma.stock_levels.groupBy.mock.calls[0];
      expect(args.where).toEqual(expect.objectContaining(FILTRO_ACTIVO));
    });
  });

  describe('punto 3/6 — bajo stock', () => {
    it('no manda a reponer un producto que el operador ya dio de baja', async () => {
      await service.getLowStock({});

      const [args] = prisma.stock_levels.findMany.mock.calls[0];
      expect(args.where).toEqual(expect.objectContaining(FILTRO_ACTIVO));
      // Y sin perder el criterio que ya tenía.
      expect(args.where.reorder_point).toEqual({ not: null });
    });
  });

  describe('puntos 4/6 y 5/6 — valuación CPP y su cobertura', () => {
    it('el detalle valorado y el denominador de la cobertura miden el MISMO universo', async () => {
      await service.getValuationSnapshot({});

      // 5/6 — filas valoradas.
      const [detalle] = prisma.stock_levels.findMany.mock.calls[0];
      expect(detalle.where).toEqual(expect.objectContaining(FILTRO_ACTIVO));
      expect(detalle.where.cost_per_unit).toEqual({ not: null });

      // 4/6 — denominador. Si este se olvidara, el numerador ya sin
      // archivados contra un denominador con ellos declararía PARCIAL un
      // informe completo.
      const [cobertura] = prisma.stock_levels.aggregate.mock.calls[0];
      expect(cobertura.where).toEqual(expect.objectContaining(FILTRO_ACTIVO));
    });

    it('una variante cuyo producto PADRE está archivado cae con él', async () => {
      // `product_variants` no tiene columna `state`: el estado vive en el
      // producto padre y TODA fila de stock —de base o de variante— lleva
      // `product_id`. Por eso el filtro navega la relación `products` y no
      // intenta un inexistente `product_variants.state`.
      await service.getValuationSnapshot({});

      const [detalle] = prisma.stock_levels.findMany.mock.calls[0];
      expect(detalle.where.products).toEqual({ state: { not: 'archived' } });
      expect(detalle.where).not.toHaveProperty('product_variants');
    });

    it('publica el valor archivado como campo aparte, medido con la misma fuente', async () => {
      prisma.stock_levels.findMany
        // Universo activo.
        .mockResolvedValueOnce([filaConCosto(100, 400)])
        // Universo archivado.
        .mockResolvedValueOnce([filaConCosto(20000, 3)]);
      prisma.stock_levels.aggregate.mockResolvedValue({
        _sum: { quantity_on_hand: 100 },
      });

      const res: any = await service.getValuationSnapshot({});

      expect(res.total_value).toBe(40000);
      expect(res.archived_stock_value).toBe(60000);
      expect(res.archived_stock_units).toBe(20000);

      const [archivado] = prisma.stock_levels.findMany.mock.calls[1];
      expect(archivado.where).toEqual(
        expect.objectContaining(FILTRO_ARCHIVADO),
      );
    });
  });

  describe('punto 6/6 — valuación FIFO', () => {
    beforeEach(() => {
      costingResolver.resolveCostingMethod.mockResolvedValue('fifo');
    });

    it('las capas de costo de un archivado no entran al total', async () => {
      orgPrisma.inventory_cost_layers.findMany.mockResolvedValue([
        {
          quantity_remaining: 10,
          unit_cost: new Prisma.Decimal(100),
          inventory_locations: { store_id: 10 },
        },
      ]);
      prisma.stock_levels.aggregate.mockResolvedValue({
        _sum: { quantity_on_hand: 10 },
      });

      const res: any = await service.getValuationSnapshot({});

      const [args] = orgPrisma.inventory_cost_layers.findMany.mock.calls[0];
      // Relación PLURAL, como la declara `inventory_cost_layers`.
      expect(args.where).toEqual(expect.objectContaining(FILTRO_ACTIVO));
      expect(args.where.quantity_remaining).toEqual({ gt: 0 });
      expect(res.total_value).toBe(1000);
    });

    it('la huella archivada se mide también en capas, no en stock_levels', async () => {
      orgPrisma.inventory_cost_layers.findMany
        .mockResolvedValueOnce([
          {
            quantity_remaining: 10,
            unit_cost: new Prisma.Decimal(100),
            inventory_locations: { store_id: 10 },
          },
        ])
        .mockResolvedValueOnce([
          { quantity_remaining: 32101, unit_cost: new Prisma.Decimal(6.8535) },
        ]);
      prisma.stock_levels.aggregate.mockResolvedValue({
        _sum: { quantity_on_hand: 10 },
      });

      const res: any = await service.getValuationSnapshot({});

      const [archivado] = orgPrisma.inventory_cost_layers.findMany.mock.calls[1];
      expect(archivado.where).toEqual(
        expect.objectContaining(FILTRO_ARCHIVADO),
      );
      expect(res.archived_stock_units).toBe(32101);
      expect(res.archived_stock_value).toBe(220004.2);
    });

    it('con ?store_id la huella archivada respeta el mismo alcance de tienda', async () => {
      orgPrisma.inventory_cost_layers.findMany.mockResolvedValue([
        {
          quantity_remaining: 1,
          unit_cost: new Prisma.Decimal(10),
          inventory_locations: { store_id: 66 },
        },
      ]);
      prisma.stock_levels.aggregate.mockResolvedValue({
        _sum: { quantity_on_hand: 1 },
      });

      await service.getValuationSnapshot({ store_id: 66 });

      const [archivado] = orgPrisma.inventory_cost_layers.findMany.mock.calls[1];
      expect(archivado.where.inventory_locations).toEqual({
        is: { store_id: 66 },
      });
    });
  });

  describe('caso límite — una organización cuyo inventario es TODO archivado', () => {
    it('cae a cero limpio: sin NaN, sin división por cero, y diciendo cuánto se fue', async () => {
      // En producción hay tres organizaciones así. El día del despliegue su
      // panel pasa de una cifra a cero exacto: tiene que ser CERO, no NaN, y
      // tiene que quedar dicho a dónde fue a parar el valor.
      prisma.stock_levels.findMany
        .mockResolvedValueOnce([]) // nada activo con costo
        .mockResolvedValueOnce([filaConCosto(500, 8453)]); // todo archivado
      prisma.stock_levels.aggregate.mockResolvedValue({
        _sum: { quantity_on_hand: null },
      });

      const res: any = await service.getValuationSnapshot({});

      expect(res.total_value).toBe(0);
      expect(Number.isNaN(res.total_value)).toBe(false);
      expect(res.cost_coverage).toEqual({
        units_total: 0,
        units_without_cost: 0,
        coverage_ratio: 1,
      });
      expect(Number.isNaN(res.cost_coverage.coverage_ratio)).toBe(false);
      expect(res.is_authoritative).toBe(true);
      expect(res.archived_stock_value).toBe(4226500);
      expect(res.archived_stock_units).toBe(500);
    });

    it('el resumen de esa organización reporta cero unidades y las archivadas aparte', async () => {
      prisma.stock_levels.aggregate
        .mockResolvedValueOnce({
          _sum: {
            quantity_on_hand: null,
            quantity_reserved: null,
            quantity_available: null,
          },
          _count: { _all: 0 },
        })
        .mockResolvedValueOnce({
          _sum: { quantity_on_hand: 500 },
          _count: { _all: 4 },
        });

      const res = await service.getStockSummary({});

      expect(res.total_quantity_on_hand).toBe(0);
      expect(res.total_skus).toBe(0);
      expect(res.archived_stock_units).toBe(500);
      expect(res.archived_skus).toBe(4);
    });
  });
});
