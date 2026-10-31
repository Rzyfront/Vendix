import { Prisma } from '@prisma/client';
import { PaymentsService } from './payments.service';

/**
 * Adiciones en el POS (H1 del PR #1003): un borrador las guarda sin
 * agendamiento; el cobro de ese borrador exige el pedido programado porque
 * sus líneas persistidas son las que se venden.
 */
describe('PaymentsService — adiciones en borradores POS', () => {
  function build(optionsOnOrder: number) {
    const optionPricingService = {
      resolve: jest.fn().mockResolvedValue({ unit_price_delta: new Prisma.Decimal(0), snapshots: [] }),
    };
    const service = Object.create(PaymentsService.prototype) as any;
    service.optionPricingService = optionPricingService;
    const tx = {
      order_item_options: { count: jest.fn().mockResolvedValue(optionsOnOrder) },
    };
    return { service, tx, optionPricingService };
  }

  it('un borrador manda draft=true a la resolución de adiciones', async () => {
    const { service, tx, optionPricingService } = build(0);
    await service.resolvePosLineOptions(tx, { product_id: 5, option_ids: [11], quantity: 3 }, 1, {
      scheduled: false,
      draft: true,
    });
    expect(optionPricingService.resolve).toHaveBeenCalledWith(1, 5, [11], 3, {
      scheduled: false,
      draft: true,
      client: tx,
    });
  });

  it('cobrar sin agendamiento un borrador con adiciones responde OPT_REQUIRES_SCHEDULE', async () => {
    const { service, tx } = build(2);
    await expect(service.assertAdoptedOptionsScheduled(tx, 77, 1)).rejects.toMatchObject({
      errorCode: 'OPT_REQUIRES_SCHEDULE',
    });
    expect(tx.order_item_options.count).toHaveBeenCalledWith({
      where: { store_id: 1, order_item: { order_id: 77 } },
    });
  });

  it('cobrar un borrador sin adiciones sigue igual que hoy', async () => {
    const { service, tx } = build(0);
    await expect(service.assertAdoptedOptionsScheduled(tx, 77, 1)).resolves.toBeUndefined();
  });
});
