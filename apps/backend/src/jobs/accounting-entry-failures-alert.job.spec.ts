import { Test, TestingModule } from '@nestjs/testing';
import { AccountingEntryFailuresAlertJob } from './accounting-entry-failures-alert.job';
import { StorePrismaService } from '../prisma/services/store-prisma.service';

/**
 * F-114 (CP-pos-exclusive-tax-double-charge) — `accounting_entry_failures`
 * no tenía lector alguno; este job es el primero. Cubre: cero filas ⇒ cero
 * notificaciones; N filas de una tienda ⇒ una notificación con el conteo
 * correcto; dos tiendas ⇒ dos notificaciones; y el comportamiento
 * anti-ruido (correr dos veces sin filas nuevas no duplica la alerta).
 */
describe('AccountingEntryFailuresAlertJob', () => {
  let job: AccountingEntryFailuresAlertJob;
  let failuresFindMany: jest.Mock;
  let storesFindMany: jest.Mock;
  let notificationsFindFirst: jest.Mock;
  let notificationsCreate: jest.Mock;

  const buildRow = (
    overrides: Partial<{
      id: number;
      organization_id: number;
      store_id: number | null;
      error_message: string;
      created_at: Date;
    }> = {},
  ) => ({
    id: 1,
    organization_id: 1,
    store_id: 10,
    error_message: 'DETECTED_TAX_MISMATCH: tipo=iva tarifa=0.19 ...',
    created_at: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  });

  beforeEach(async () => {
    failuresFindMany = jest.fn().mockResolvedValue([]);
    storesFindMany = jest.fn().mockResolvedValue([]);
    notificationsFindFirst = jest.fn().mockResolvedValue(null);
    notificationsCreate = jest.fn().mockResolvedValue(undefined);

    const prismaMock = {
      withoutScope: () => ({
        accounting_entry_failures: { findMany: failuresFindMany },
        stores: { findMany: storesFindMany },
        notifications: {
          findFirst: notificationsFindFirst,
          create: notificationsCreate,
        },
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountingEntryFailuresAlertJob,
        { provide: StorePrismaService, useValue: prismaMock },
      ],
    }).compile();

    job = module.get(AccountingEntryFailuresAlertJob);
  });

  it('cero filas sin resolver ⇒ cero notificaciones', async () => {
    failuresFindMany.mockResolvedValue([]);

    await job.handleAccountingEntryFailuresAlert();

    expect(notificationsCreate).not.toHaveBeenCalled();
  });

  it('N filas de UNA tienda ⇒ UNA notificación con el conteo correcto', async () => {
    failuresFindMany.mockResolvedValue([
      buildRow({ id: 1, created_at: new Date('2026-01-01T00:00:00Z') }),
      buildRow({ id: 2, created_at: new Date('2026-01-01T01:00:00Z') }),
      buildRow({ id: 3, created_at: new Date('2026-01-01T02:00:00Z') }),
    ]);

    await job.handleAccountingEntryFailuresAlert();

    expect(notificationsCreate).toHaveBeenCalledTimes(1);
    const call = notificationsCreate.mock.calls[0][0];
    expect(call.data.store_id).toBe(10);
    expect(call.data.data.total_unresolved).toBe(3);
    expect(call.data.data.new_since_last_alert).toBe(3);
    expect(call.data.data.alert_type).toBe('accounting_entry_failures');
  });

  it('filas repartidas en DOS tiendas ⇒ DOS notificaciones, una por tienda', async () => {
    failuresFindMany.mockResolvedValue([
      buildRow({ id: 1, store_id: 10 }),
      buildRow({ id: 2, store_id: 20 }),
    ]);

    await job.handleAccountingEntryFailuresAlert();

    expect(notificationsCreate).toHaveBeenCalledTimes(2);
    const store_ids = notificationsCreate.mock.calls
      .map((c) => c[0].data.store_id)
      .sort();
    expect(store_ids).toEqual([10, 20]);
  });

  it('fallo SIN store_id (a nivel organización) se reparte a cada tienda activa', async () => {
    failuresFindMany.mockResolvedValue([
      buildRow({ id: 1, store_id: null, organization_id: 7 }),
    ]);
    storesFindMany.mockResolvedValue([{ id: 30 }, { id: 31 }]);

    await job.handleAccountingEntryFailuresAlert();

    expect(storesFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organization_id: 7, is_active: true },
      }),
    );
    expect(notificationsCreate).toHaveBeenCalledTimes(2);
  });

  it('ANTI-RUIDO: sin filas nuevas desde la última alerta, NO vuelve a notificar', async () => {
    const first_created_at = new Date('2026-01-01T00:00:00Z');
    failuresFindMany.mockResolvedValue([
      buildRow({ id: 1, created_at: first_created_at }),
    ]);

    // Primera corrida: no hay alerta previa ⇒ notifica.
    await job.handleAccountingEntryFailuresAlert();
    expect(notificationsCreate).toHaveBeenCalledTimes(1);

    // Segunda corrida: la MISMA fila sigue sin resolver (resolved_at sigue
    // null — nada cambia en accounting_entry_failures), pero ahora existe
    // una alerta previa más nueva que la fila.
    notificationsFindFirst.mockResolvedValue({
      created_at: new Date('2026-01-02T00:00:00Z'),
    });

    await job.handleAccountingEntryFailuresAlert();

    // No se creó una segunda notificación: cero filas nuevas desde la
    // última alerta.
    expect(notificationsCreate).toHaveBeenCalledTimes(1);
  });

  it('ANTI-RUIDO: SÍ notifica de nuevo si aparece una fila más nueva que la última alerta', async () => {
    notificationsFindFirst.mockResolvedValue({
      created_at: new Date('2026-01-01T00:00:00Z'),
    });
    failuresFindMany.mockResolvedValue([
      buildRow({ id: 1, created_at: new Date('2026-01-01T00:00:00Z') }), // ya alertada
      buildRow({ id: 2, created_at: new Date('2026-01-02T12:00:00Z') }), // nueva
    ]);

    await job.handleAccountingEntryFailuresAlert();

    expect(notificationsCreate).toHaveBeenCalledTimes(1);
    const call = notificationsCreate.mock.calls[0][0];
    expect(call.data.data.total_unresolved).toBe(2);
    expect(call.data.data.new_since_last_alert).toBe(1);
  });

  it('agrupa las causas de recordSkip (prefijo CAUSA:) y recordFailure (mensaje crudo) por separado', async () => {
    failuresFindMany.mockResolvedValue([
      buildRow({ id: 1, error_message: 'DETECTED_TAX_MISMATCH: tipo=iva ...' }),
      buildRow({ id: 2, error_message: 'SKIPPED_MISSING_MAPPING: sin cuenta' }),
      buildRow({ id: 3, error_message: 'Unexpected token in JSON at position 4' }),
    ]);

    await job.handleAccountingEntryFailuresAlert();

    const call = notificationsCreate.mock.calls[0][0];
    expect(call.data.data.causes.sort()).toEqual([
      'DETECTED_TAX_MISMATCH',
      'ERROR',
      'SKIPPED_MISSING_MAPPING',
    ]);
  });
});
