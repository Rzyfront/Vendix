import { PromotionsService } from './promotions.service';

/**
 * Auditoría de promociones: listado para POS (`/active`), resumen y
 * transiciones de estado evaluados en la zona horaria de la tienda.
 */
describe('PromotionsService', () => {
  let prisma: any;
  let service: PromotionsService;

  const promo = (overrides: Record<string, unknown> = {}) => ({
    id: 1,
    state: 'active',
    priority: 0,
    usage_limit: null,
    usage_count: 0,
    active_weekdays: [],
    start_date: new Date('2026-01-01T00:00:00Z'),
    end_date: null,
    ...overrides,
  });

  beforeEach(() => {
    prisma = {
      store_settings: {
        findFirst: jest.fn().mockResolvedValue({
          settings: {},
          stores: { timezone: 'America/Bogota' },
        }),
      },
      promotions: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        update: jest.fn().mockImplementation(async ({ data }) => data),
        count: jest.fn().mockResolvedValue(0),
        aggregate: jest.fn().mockResolvedValue({ _sum: { usage_count: 0 } }),
      },
      order_promotions: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { discount_amount: 0 } }),
      },
      coupons: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(),
    };
    service = new PromotionsService(prisma);
    // Jueves 19-nov-2026 10:00 en Bogotá.
    jest.useFakeTimers().setSystemTime(new Date('2026-11-19T15:00:00Z'));
  });

  afterEach(() => jest.useRealTimers());

  describe('getActive (promos que el POS puede aplicar hoy)', () => {
    it('excluye las de otro día y las de cupo agotado, y ordena como el motor', async () => {
      prisma.promotions.findMany.mockResolvedValue([
        promo({ id: 1 }),
        promo({ id: 2, active_weekdays: [2] }), // solo martes
        promo({ id: 3, usage_limit: 5, usage_count: 5 }),
        promo({ id: 4, active_weekdays: [4] }), // jueves
      ]);
      const rows = await service.getActive();
      expect(rows.map((r: any) => r.id)).toEqual([1, 4]);
      const args = prisma.promotions.findMany.mock.calls[0][0];
      expect(args.orderBy).toEqual([{ priority: 'asc' }, { id: 'asc' }]);
      expect(args.where.OR).toEqual([
        { end_date: null },
        { end_date: { gte: new Date('2026-11-19T00:00:00Z') } },
      ]);
    });
  });

  describe('activate', () => {
    it('no reactiva una promoción cancelada', async () => {
      prisma.promotions.findFirst.mockResolvedValue(promo({ state: 'cancelled' }));
      await expect(service.activate(1)).rejects.toMatchObject({
        response: { error_code: 'PROMOTION_STATE_001' },
      });
      expect(prisma.promotions.update).not.toHaveBeenCalled();
    });

    it('una promo que empieza hoy (fecha local) queda activa, no programada', async () => {
      prisma.promotions.findFirst.mockResolvedValue(
        promo({ state: 'draft', start_date: new Date('2026-11-19T00:00:00Z') }),
      );
      const result: any = await service.activate(1);
      expect(result.state).toBe('active');
    });
  });

  describe('códigos compartidos con cupones', () => {
    const dto: any = {
      name: 'Martes',
      code: 'MARTES20',
      type: 'percentage',
      value: 20,
      start_date: '2026-11-01',
    };

    it('no permite crear una promo con el código de un cupón existente', async () => {
      prisma.coupons.findFirst.mockResolvedValue({ id: 3 });
      await expect(service.create(dto)).rejects.toMatchObject({
        response: {
          error_code: 'PROMOTION_CODE_DUP_001',
          message: 'Ya existe un cupón con ese código',
        },
      });
      expect(prisma.coupons.findFirst.mock.calls[0][0].where).toEqual({
        code: { equals: 'MARTES20', mode: 'insensitive' },
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('no permite repetir el código de otra promoción', async () => {
      prisma.promotions.findFirst.mockResolvedValue({ id: 9 });
      await expect(service.create(dto)).rejects.toMatchObject({
        response: { error_code: 'PROMOTION_CODE_DUP_001' },
      });
    });
  });

  describe('getSummary', () => {
    it('cuenta como activas también las programadas cuya fecha ya llegó', async () => {
      await service.getSummary();
      const activeWhere = prisma.promotions.count.mock.calls[0][0].where;
      expect(activeWhere.state).toEqual({ in: ['active', 'scheduled'] });
    });
  });

  describe('findAll', () => {
    it('expone el estado efectivo derivado de las fechas', async () => {
      prisma.promotions.findMany.mockResolvedValue([
        promo({ id: 1, end_date: new Date('2026-11-18T00:00:00Z') }),
        promo({ id: 2, end_date: new Date('2026-11-19T00:00:00Z') }),
        promo({ id: 3, state: 'scheduled', start_date: new Date('2026-12-01T00:00:00Z') }),
      ]);
      const { data } = await service.findAll({} as any);
      expect(data.map((p: any) => p.effective_state)).toEqual([
        'expired',
        'active',
        'scheduled',
      ]);
    });
  });
});
