import { BadRequestException } from '@nestjs/common';
import { DispatchRoutesService } from './dispatch-routes.service';
import { RequestContextService } from '@common/context/request-context.service';

describe('DispatchRoutesService — create (route assembly + numbering)', () => {
  let service: DispatchRoutesService;
  let prismaMock: any;
  let routeNumberGeneratorMock: any;
  let context: any;

  const STORE_ID = 100;
  const USER_ID = 1;

  const baseDto = (overrides: any = {}) => ({
    driver_user_id: 9,
    is_primary_driver_external: false,
    planned_date: '2026-06-19',
    currency: 'COP',
    stops: [
      { dispatch_note_id: 900, stop_sequence: 1 },
      { dispatch_note_id: 901, stop_sequence: 2 },
    ],
    ...overrides,
  });

  // Two notes that exist and belong to the store; none prepaid.
  const buildExistingNotes = () => [
    {
      id: 900,
      store_id: STORE_ID,
      status: 'pending',
      sales_order_id: 5000,
      grand_total: 200,
      invoice: null,
    },
    {
      id: 901,
      store_id: STORE_ID,
      status: 'pending',
      sales_order_id: 5001,
      grand_total: 150,
      invoice: null,
    },
  ];

  beforeEach(() => {
    context = {
      store_id: STORE_ID,
      organization_id: 1,
      user_id: USER_ID,
      is_super_admin: false,
    };

    prismaMock = {
      dispatch_routes: {
        create: jest.fn(),
        findFirst: jest.fn(),
      },
      dispatch_notes: {
        findMany: jest.fn(),
      },
      dispatch_route_stops: {
        findMany: jest.fn(),
      },
      vehicles: {
        findFirst: jest.fn(),
      },
    };

    routeNumberGeneratorMock = {
      generateNextNumber: jest.fn().mockResolvedValue('PLN2606190001'),
    };

    jest.spyOn(RequestContextService, 'getContext').mockReturnValue(context);

    service = new DispatchRoutesService(
      prismaMock as any,
      routeNumberGeneratorMock as any,
    );
  });

  afterEach(() => jest.clearAllMocks());

  it('generates a route_number via the generator and creates the route store-scoped', async () => {
    prismaMock.dispatch_notes.findMany.mockResolvedValue(buildExistingNotes());
    prismaMock.dispatch_route_stops.findMany.mockResolvedValue([]);
    prismaMock.dispatch_routes.create.mockImplementation((args: any) => ({
      id: 1,
      ...args.data,
    }));

    await service.create(baseDto() as any);

    expect(routeNumberGeneratorMock.generateNextNumber).toHaveBeenCalledWith(
      STORE_ID,
    );

    expect(prismaMock.dispatch_routes.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          store_id: STORE_ID,
          route_number: 'PLN2606190001',
          status: 'draft',
          created_by_user_id: USER_ID,
        }),
      }),
    );
  });

  it('assembles stops (nested create) for each dispatch_note with computed totals', async () => {
    prismaMock.dispatch_notes.findMany.mockResolvedValue(buildExistingNotes());
    prismaMock.dispatch_route_stops.findMany.mockResolvedValue([]);
    prismaMock.dispatch_routes.create.mockImplementation((args: any) => ({
      id: 1,
      ...args.data,
    }));

    await service.create(baseDto() as any);

    const createArg = prismaMock.dispatch_routes.create.mock.calls[0][0];
    const stopsCreate = createArg.data.stops.create;

    // One stop per dispatch_note.
    expect(stopsCreate).toHaveLength(2);
    expect(stopsCreate.map((s: any) => s.dispatch_note_id).sort()).toEqual([
      900, 901,
    ]);
    // Neither note is prepaid → total_to_collect = 200 + 150.
    expect(createArg.data.total_to_collect).toBe(350);
    expect(createArg.data.total_prepaid).toBe(0);
    // Every stop starts with zeroed collection fields.
    for (const stop of stopsCreate) {
      expect(stop.is_prepaid).toBe(false);
      expect(stop.collected_amount).toBe(0);
    }
  });

  it('marks a stop as prepaid when its dispatch_note invoice has a payment_date', async () => {
    const notes = buildExistingNotes();
    notes[0].invoice = { id: 1, status: 'paid', payment_date: new Date() } as any;
    prismaMock.dispatch_notes.findMany.mockResolvedValue(notes);
    prismaMock.dispatch_route_stops.findMany.mockResolvedValue([]);
    prismaMock.dispatch_routes.create.mockImplementation((args: any) => ({
      id: 1,
      ...args.data,
    }));

    await service.create(baseDto() as any);

    const createArg = prismaMock.dispatch_routes.create.mock.calls[0][0];
    const prepaidStop = createArg.data.stops.create.find(
      (s: any) => s.dispatch_note_id === 900,
    );
    expect(prepaidStop.is_prepaid).toBe(true);
    // Prepaid note (200) excluded from total_to_collect; only note 901 (150) counts.
    expect(createArg.data.total_to_collect).toBe(150);
    expect(createArg.data.total_prepaid).toBe(200);
  });

  it('throws BadRequestException when a dispatch_note does not exist / belong to the store', async () => {
    // Only one of the two requested notes comes back.
    prismaMock.dispatch_notes.findMany.mockResolvedValue([
      buildExistingNotes()[0],
    ]);

    await expect(service.create(baseDto() as any)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prismaMock.dispatch_routes.create).not.toHaveBeenCalled();
  });

  it('throws BadRequestException when an internal route has no driver_user_id', async () => {
    await expect(
      service.create(
        baseDto({ driver_user_id: undefined }) as any,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prismaMock.dispatch_routes.create).not.toHaveBeenCalled();
  });

  it('throws BadRequestException on duplicated dispatch_note_id in stops', async () => {
    await expect(
      service.create(
        baseDto({
          stops: [
            { dispatch_note_id: 900, stop_sequence: 1 },
            { dispatch_note_id: 900, stop_sequence: 2 },
          ],
        }) as any,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prismaMock.dispatch_routes.create).not.toHaveBeenCalled();
  });
});
