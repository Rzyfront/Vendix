import { RequestContextService } from '@common/context/request-context.service';
import { BookingPublicController } from './booking-public.controller';

/**
 * Apps booking-detail — the public booking page sends the hotel's real stay
 * data only when its page uses it (`stay_detail` or `visible_when`); an older
 * page keeps exactly its previous response.
 */
describe('BookingPublicController.get (stay_facts)', () => {
  const defaults = { check_in: 'Desde las 3:00 p. m.', check_out: 'Hasta las 12:00 m.', cancellation: null };
  const stayFacts = { check_in: 'Desde las 3:00 p. m.', max_guests: 4, has_photos: true };

  const build = (page: unknown) => {
    const prisma = {
      store_apps: { findFirst: jest.fn().mockResolvedValue({ config: page ? { page } : {} }) },
      lodging_unit_types: { count: jest.fn().mockResolvedValue(2) },
      products: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const policies = {
      fill: jest.fn(async (_storeId: number, p: unknown) => p),
      readWithStayFacts: jest.fn().mockResolvedValue({ defaults, stayFacts }),
    };
    const response = { success: jest.fn((data: unknown) => data) };
    const controller = new BookingPublicController(
      prisma as never,
      {} as never,
      policies as never,
      response as never,
    );
    return { controller, policies };
  };

  beforeEach(() => jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(7));
  afterEach(() => jest.restoreAllMocks());

  it('incluye stay_facts y rellena policies en una sola lectura cuando la página tiene stay_detail', async () => {
    const { controller, policies } = build({
      schema_version: 1,
      blocks: [
        { id: 'stay', type: 'stay_detail', props: { show_deposit: true } },
        { id: 'policies', type: 'policies', props: { title: 'Políticas' } },
      ],
    });
    const data = (await controller.get()) as unknown as Record<string, unknown>;
    expect(data['stay_facts']).toEqual(stayFacts);
    expect((data['page'] as any).blocks[1].props).toMatchObject({
      title: 'Políticas',
      check_in: 'Desde las 3:00 p. m.',
      check_out: 'Hasta las 12:00 m.',
    });
    expect(policies.readWithStayFacts).toHaveBeenCalledTimes(1);
    expect(policies.readWithStayFacts).toHaveBeenCalledWith(7);
    expect(policies.fill).not.toHaveBeenCalled();
  });

  it('una página sin stay_detail ni condiciones responde como antes', async () => {
    const { controller, policies } = build({
      schema_version: 1,
      blocks: [{ id: 'faq', type: 'faq', props: { title: 'Preguntas' } }],
    });
    const data = (await controller.get()) as unknown as Record<string, unknown>;
    expect(data).not.toHaveProperty('stay_facts');
    expect(policies.readWithStayFacts).not.toHaveBeenCalled();
    expect(policies.fill).toHaveBeenCalledTimes(1);

    const legacy = build(null);
    expect(await legacy.controller.get()).toEqual({ product_ids: [] });
  });
});
