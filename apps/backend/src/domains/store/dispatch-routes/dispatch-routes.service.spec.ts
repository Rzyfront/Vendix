import { BadRequestException } from '@nestjs/common';
import { DispatchRoutesService } from './dispatch-routes.service';
import { RouteFlowService } from './route-flow/route-flow.service';
import { RequestContextService } from '@common/context/request-context.service';

describe('DispatchRoutesService — create (route assembly + numbering)', () => {
  let service: DispatchRoutesService;
  let prismaMock: any;
  let routeNumberGeneratorMock: any;
  let eventEmitterMock: any;
  let routeFlow: RouteFlowService;
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

  // Two notes that exist and belong to the store; both eligible (confirmed),
  // none prepaid. Carry dispatch_number + order_id so the eligibility error
  // detail and the auto-confirm payload have their fields.
  const buildExistingNotes = () => [
    {
      id: 900,
      store_id: STORE_ID,
      dispatch_number: 'REM-900',
      status: 'confirmed',
      sales_order_id: 5000,
      order_id: 7000,
      grand_total: 200,
      needs_collection: undefined,
      invoice: null,
    },
    {
      id: 901,
      store_id: STORE_ID,
      dispatch_number: 'REM-901',
      status: 'confirmed',
      sales_order_id: 5001,
      order_id: 7001,
      grand_total: 150,
      needs_collection: undefined,
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
        update: jest.fn(),
      },
      dispatch_notes: {
        findMany: jest.fn(),
        update: jest.fn(),
      },
      dispatch_route_stops: {
        findMany: jest.fn(),
        createMany: jest.fn(),
      },
      vehicles: {
        findFirst: jest.fn(),
      },
    };
    // Run the transaction callback with the prismaMock itself as the tx client,
    // so `tx.<model>.<op>` routes to the same jest.fn() the assertions inspect.
    prismaMock.$transaction = jest.fn((cb: any) => cb(prismaMock));

    routeNumberGeneratorMock = {
      generateNextNumber: jest.fn().mockResolvedValue('PLN2606190001'),
    };

    eventEmitterMock = { emit: jest.fn() };

    // Real RouteFlowService so the auto-confirm helpers actually run (they only
    // use the tx + eventEmitter; prisma/cashSettlement/pdfExport are unused by
    // confirmDraftNotesInTx / emitConfirmedNotes).
    routeFlow = new RouteFlowService(
      prismaMock as any,
      eventEmitterMock as any,
      {} as any,
      {} as any,
    );

    jest.spyOn(RequestContextService, 'getContext').mockReturnValue(context);

    service = new DispatchRoutesService(
      prismaMock as any,
      routeNumberGeneratorMock as any,
      {} as any,
      routeFlow,
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

  it('throws DSP_NOTE_NOT_ELIGIBLE_001 when a note is not planificable (delivered) on create', async () => {
    const notes = buildExistingNotes();
    notes[0].status = 'delivered';
    prismaMock.dispatch_notes.findMany.mockResolvedValue(notes);
    prismaMock.dispatch_route_stops.findMany.mockResolvedValue([]);

    await expect(service.create(baseDto() as any)).rejects.toMatchObject({
      errorCode: 'DSP_NOTE_NOT_ELIGIBLE_001',
    });
    // Rejected before persisting anything.
    expect(prismaMock.dispatch_routes.create).not.toHaveBeenCalled();
    expect(prismaMock.dispatch_notes.update).not.toHaveBeenCalled();
  });

  it('auto-confirms a draft dispatch_note and emits dispatch_note.confirmed on create', async () => {
    const notes = buildExistingNotes();
    notes[0].status = 'draft'; // 900 in draft → must be confirmed on the fly
    notes[1].status = 'confirmed'; // 901 already confirmed → skipped
    prismaMock.dispatch_notes.findMany.mockResolvedValue(notes);
    prismaMock.dispatch_route_stops.findMany.mockResolvedValue([]);
    prismaMock.dispatch_routes.create.mockImplementation((args: any) => ({
      id: 1,
      ...args.data,
    }));

    await service.create(baseDto() as any);

    // The draft note (900) is flipped to 'confirmed' inside the tx.
    expect(prismaMock.dispatch_notes.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 900 },
        data: expect.objectContaining({ status: 'confirmed' }),
      }),
    );
    // Only the draft note produces an update (901 was already confirmed).
    expect(prismaMock.dispatch_notes.update).toHaveBeenCalledTimes(1);
    // A single dispatch_note.confirmed event is emitted post-commit.
    expect(eventEmitterMock.emit).toHaveBeenCalledWith(
      'dispatch_note.confirmed',
      expect.objectContaining({ dispatch_note_id: 900, order_id: 7000 }),
    );
    expect(eventEmitterMock.emit).toHaveBeenCalledTimes(1);
  });
});

describe('DispatchRoutesService — addStops (eligibility + auto-confirm)', () => {
  let service: DispatchRoutesService;
  let prismaMock: any;
  let eventEmitterMock: any;
  let routeFlow: RouteFlowService;

  const STORE_ID = 100;
  const USER_ID = 1;

  beforeEach(() => {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
      store_id: STORE_ID,
      organization_id: 1,
      user_id: USER_ID,
      is_super_admin: false,
    } as any);

    prismaMock = {
      dispatch_routes: { findFirst: jest.fn(), update: jest.fn() },
      dispatch_notes: { findMany: jest.fn(), update: jest.fn() },
      dispatch_route_stops: { findMany: jest.fn(), createMany: jest.fn() },
    };
    prismaMock.$transaction = jest.fn((cb: any) => cb(prismaMock));

    eventEmitterMock = { emit: jest.fn() };
    routeFlow = new RouteFlowService(
      prismaMock as any,
      eventEmitterMock as any,
      {} as any,
      {} as any,
    );

    service = new DispatchRoutesService(
      prismaMock as any,
      { generateNextNumber: jest.fn() } as any,
      {} as any,
      routeFlow,
    );
  });

  afterEach(() => jest.clearAllMocks());

  it('throws DSP_NOTE_NOT_ELIGIBLE_001 when adding a delivered note', async () => {
    prismaMock.dispatch_routes.findFirst.mockResolvedValue({
      id: 1,
      status: 'draft',
      stops: [],
    });
    prismaMock.dispatch_notes.findMany.mockResolvedValue([
      {
        id: 902,
        store_id: STORE_ID,
        dispatch_number: 'REM-902',
        status: 'delivered',
        sales_order_id: null,
        order_id: null,
        grand_total: 100,
        needs_collection: undefined,
        invoice: null,
      },
    ]);

    await expect(
      service.addStops(1, { stops: [{ dispatch_note_id: 902 }] } as any),
    ).rejects.toMatchObject({ errorCode: 'DSP_NOTE_NOT_ELIGIBLE_001' });
    // Rejected before inserting the stop or confirming anything.
    expect(prismaMock.dispatch_route_stops.createMany).not.toHaveBeenCalled();
    expect(prismaMock.dispatch_notes.update).not.toHaveBeenCalled();
  });

  it('auto-confirms a draft note added to a dispatched route and emits dispatch_note.confirmed', async () => {
    prismaMock.dispatch_routes.findFirst.mockResolvedValue({
      id: 1,
      status: 'dispatched',
      stops: [],
    });
    // First findMany → new_notes; second findMany → existing_notes_full (empty).
    prismaMock.dispatch_notes.findMany
      .mockResolvedValueOnce([
        {
          id: 903,
          store_id: STORE_ID,
          dispatch_number: 'REM-903',
          status: 'draft',
          sales_order_id: 6000,
          order_id: 8000,
          grand_total: 300,
          needs_collection: undefined,
          invoice: null,
        },
      ])
      .mockResolvedValueOnce([]);
    prismaMock.dispatch_route_stops.findMany.mockResolvedValue([]); // other_stops
    prismaMock.dispatch_route_stops.createMany.mockResolvedValue({ count: 1 });
    prismaMock.dispatch_routes.update.mockImplementation((args: any) => ({
      id: 1,
      ...args.data,
    }));

    await service.addStops(1, { stops: [{ dispatch_note_id: 903 }] } as any);

    // The newly added draft note is confirmed inside the tx.
    expect(prismaMock.dispatch_notes.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 903 },
        data: expect.objectContaining({ status: 'confirmed' }),
      }),
    );
    // And the confirmed event is emitted post-commit with the full payload.
    expect(eventEmitterMock.emit).toHaveBeenCalledWith(
      'dispatch_note.confirmed',
      expect.objectContaining({
        dispatch_note_id: 903,
        dispatch_number: 'REM-903',
        store_id: STORE_ID,
        sales_order_id: 6000,
        order_id: 8000,
      }),
    );
  });
});
