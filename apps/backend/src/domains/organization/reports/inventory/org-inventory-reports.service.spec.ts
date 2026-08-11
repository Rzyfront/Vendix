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
