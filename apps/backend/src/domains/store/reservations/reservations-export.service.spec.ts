import { ReservationsExportService } from './reservations-export.service';

/** QUI-975 — export dataset: full range, filters, raw values. */
describe('ReservationsExportService.getExportRows (QUI-975)', () => {
  const row = (overrides: any = {}) => ({
    booking_number: 'RSV-1',
    date: new Date('2026-11-02T00:00:00.000Z'),
    start_time: '08:00',
    end_time: '08:30',
    status: 'confirmed',
    channel: 'pos',
    product: { name: 'Corte' },
    provider: { display_name: 'Juan Perez', employee: { first_name: 'Juan' } },
    customer: { first_name: 'Ana', last_name: 'Ruiz', phone: '3001112233' },
    order: { order_number: 'O-9', grand_total: '25000.00' },
    ...overrides,
  });

  function buildService(rows: any[]) {
    const prisma: any = {
      bookings: { findMany: jest.fn().mockResolvedValue(rows) },
    };
    return { service: new ReservationsExportService(prisma), prisma };
  }

  it('maps one row per booking with raw values', async () => {
    const { service, prisma } = buildService([row()]);
    const { rows, truncated } = await service.getExportRows({} as any);
    expect(truncated).toBe(false);
    expect(rows).toEqual([
      {
        booking_number: 'RSV-1',
        date: new Date('2026-11-02T00:00:00.000Z'),
        start_time: '08:00',
        end_time: '08:30',
        service_name: 'Corte',
        provider_name: 'Juan Perez',
        customer_first_name: 'Ana',
        customer_last_name: 'Ruiz',
        customer_phone: '3001112233',
        status: 'confirmed',
        channel: 'pos',
        order_number: 'O-9',
        total: 25000,
      },
    ]);
    expect(prisma.bookings.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ date: 'asc' }, { start_time: 'asc' }],
        take: ReservationsExportService.EXPORT_ROW_LIMIT + 1,
      }),
    );
  });

  it('applies status/provider/product/date filters', async () => {
    const { service, prisma } = buildService([]);
    await service.getExportRows({
      status: 'pending',
      provider_id: 5,
      product_id: 10,
      date_from: '2026-11-01',
      date_to: '2026-11-07',
    } as any);
    expect(prisma.bookings.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: 'pending',
          provider_id: 5,
          product_id: 10,
          date: {
            gte: new Date('2026-11-01'),
            lte: new Date('2026-11-07'),
          },
        },
      }),
    );
  });

  it('flags truncation past the explicit row limit', async () => {
    const many = Array.from(
      { length: ReservationsExportService.EXPORT_ROW_LIMIT + 1 },
      (_, i) => row({ booking_number: `RSV-${i}` }),
    );
    const { service } = buildService(many);
    const { rows, truncated } = await service.getExportRows({} as any);
    expect(truncated).toBe(true);
    expect(rows).toHaveLength(ReservationsExportService.EXPORT_ROW_LIMIT);
  });

  it('leaves blanks for bookings without provider/customer/order', async () => {
    const { service } = buildService([
      row({ provider: null, customer: null, order: null }),
    ]);
    const { rows } = await service.getExportRows({} as any);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        provider_name: '',
        customer_first_name: '',
        customer_last_name: '',
        customer_phone: '',
        order_number: '',
        total: 0,
      }),
    );
  });

  it('falls back to the employee first name when display_name is blank', async () => {
    const { service } = buildService([
      row({
        provider: { display_name: '  ', employee: { first_name: 'Juan' } },
      }),
    ]);
    const { rows } = await service.getExportRows({} as any);
    expect(rows[0].provider_name).toBe('Juan');
  });
});
