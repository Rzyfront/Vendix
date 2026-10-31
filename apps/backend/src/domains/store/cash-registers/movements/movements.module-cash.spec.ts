import { MovementsService } from './movements.service';

/**
 * B04 — helper único para dinero en efectivo de módulos fuera del POS
 * (separados, CxC, anticipos): un `cash_in`/`cash_out` en la sesión abierta
 * del usuario, con lock, solo para efectivo y con la caja habilitada.
 */
describe('MovementsService.recordModuleCashMovement', () => {
  const STORE_ID = 10;
  const USER_ID = 7;

  const makeDb = (opts: {
    enabled?: boolean;
    session?: { id: number } | null;
    existing?: { id: number } | null;
  }) => {
    const db = {
      store_settings: {
        findUnique: jest.fn().mockResolvedValue({
          settings: { pos: { cash_register: { enabled: opts.enabled ?? true } } },
        }),
      },
      cash_register_sessions: {
        findFirst: jest
          .fn()
          .mockResolvedValue(opts.session === undefined ? { id: 200 } : opts.session),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ id: 200 }]),
      cash_register_movements: {
        findFirst: jest.fn().mockResolvedValue(opts.existing ?? null),
        create: jest.fn(async ({ data }: any) => ({ id: 900, ...data })),
      },
    };
    return db;
  };

  const service = new MovementsService({} as any, { emit: jest.fn() } as any);
  const base = {
    store_id: STORE_ID,
    user_id: USER_ID,
    direction: 'in' as const,
    amount: 50000,
    payment_method: 'cash',
    source_type: 'layaway_payment',
    source_id: 12,
    reference: 'Abono separado #12',
  };

  it('efectivo entrante crea cash_in con source y referencia', async () => {
    const db = makeDb({});
    const res = await service.recordModuleCashMovement(db as any, base);
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
    expect(db.cash_register_movements.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        session_id: 200,
        store_id: STORE_ID,
        user_id: USER_ID,
        type: 'cash_in',
        amount: 50000,
        payment_method: 'cash',
        reference: 'Abono separado #12',
        source_type: 'layaway_payment',
        source_id: 12,
      }),
    });
    expect(res).toEqual(expect.objectContaining({ id: 900 }));
  });

  it('efectivo saliente crea cash_out', async () => {
    const db = makeDb({});
    await service.recordModuleCashMovement(db as any, {
      ...base,
      direction: 'out',
    });
    expect(db.cash_register_movements.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: 'cash_out' }),
    });
  });

  it('método no efectivo no crea movimiento ni lee la sesión', async () => {
    const db = makeDb({});
    const res = await service.recordModuleCashMovement(db as any, {
      ...base,
      payment_method: 'card',
    });
    expect(res).toBeNull();
    expect(db.cash_register_movements.create).not.toHaveBeenCalled();
    expect(db.cash_register_sessions.findFirst).not.toHaveBeenCalled();
  });

  it('método ausente no se asume efectivo', async () => {
    const db = makeDb({});
    const res = await service.recordModuleCashMovement(db as any, {
      ...base,
      payment_method: null,
    });
    expect(res).toBeNull();
    expect(db.cash_register_movements.create).not.toHaveBeenCalled();
  });

  it('caja deshabilitada: no crea movimiento ni exige sesión', async () => {
    const db = makeDb({ enabled: false, session: null });
    const res = await service.recordModuleCashMovement(db as any, base);
    expect(res).toBeNull();
    expect(db.cash_register_movements.create).not.toHaveBeenCalled();
  });

  it('caja habilitada sin sesión del usuario: CASH_SESSION_REQUIRED_001', async () => {
    const db = makeDb({ session: null });
    await expect(
      service.recordModuleCashMovement(db as any, base),
    ).rejects.toMatchObject({ errorCode: 'CASH_SESSION_REQUIRED_001' });
    expect(db.cash_register_movements.create).not.toHaveBeenCalled();
  });

  it('reintento: devuelve el movimiento existente y no crea otro', async () => {
    const db = makeDb({ existing: { id: 555 } });
    const res = await service.recordModuleCashMovement(db as any, base);
    expect(res).toEqual({ id: 555 });
    expect(db.cash_register_movements.create).not.toHaveBeenCalled();
    expect(db.cash_register_movements.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          store_id: STORE_ID,
          source_type: 'layaway_payment',
          source_id: 12,
          type: 'cash_in',
        },
      }),
    );
  });
});
