import { matchesWhere } from '../../store/reminders/testing/fake-reminders-prisma';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { FiscalTaxCalendarService } from './fiscal-tax-calendar.service';
import { resolveFiscalPeriodRange } from './fiscal-period.util';
import { FiscalObligationService } from './fiscal-obligation.service';
import { FiscalAuditService } from './fiscal-audit.service';
import { FiscalOperationsContext } from './fiscal-context-resolver.service';
import {
  CALENDAR_REPLACED_MARKER,
  FiscalCalendarRemindersService,
} from './fiscal-calendar-reminders.service';

type Row = Record<string, any>;

/** 2026-11-19 10:00 en Bogotá. */
const NOW = new Date('2026-11-19T15:00:00Z');
/** NIT terminado en 9: IVA bimestral sep-oct vence 24 nov 2026; nov-dic, 25 ene 2027. */
const NIT = '900123459';

const CONTEXT: FiscalOperationsContext = {
  organization_id: 1,
  store_id: 1,
  fiscal_scope: 'STORE',
  operating_scope: 'STORE',
  accounting_entity_id: 7,
  accounting_entity: { id: 7, tax_id: NIT },
};

const RESPONSIBLE = { tax_responsibilities: ['O-48'] };

/**
 * Fake de lo mínimo que toca el servicio. `generateForContext` replica la
 * semántica real (busca por rango, crea `blocked` sin fecha oficial, refresca
 * solo con `force_refresh`) sobre el calendario DIAN REAL; un `override` por
 * año simula «la DIAN publicó el calendario 2027».
 */
function setup(options: { fiscalData?: Row; nit?: string | null; retention?: string[] } = {}) {
  const obligations: Row[] = [];
  const reminders: Row[] = [];
  let fiscalData: Row = options.fiscalData ?? { ...RESPONSIBLE, vat_periodicity: 'bimonthly' };
  let nextObligationId = 100;
  let nextReminderId = 1;
  const published2027: Record<number, number> = {};
  const taxCalendar = new FiscalTaxCalendarService();
  const context: FiscalOperationsContext = {
    ...CONTEXT,
    accounting_entity: { id: 7, tax_id: options.nit === undefined ? NIT : options.nit },
  };

  const withObligation = (r: Row) => ({
    ...r,
    fiscal_obligation: (() => {
      const obligation = obligations.find((o) => o.id === r.fiscal_obligation_id);
      // Los borradores de declaración se filtran con `none: {}` en la vista previa.
      return obligation ? { ...obligation, declaration_drafts: [] } : null;
    })(),
  });

  const prisma = {
    store_settings: {
      findUnique: jest.fn(async () => ({ settings: { fiscal_data: fiscalData } })),
      findFirst: jest.fn(async () => ({ settings: {}, stores: { timezone: 'America/Bogota' } })),
    },
    organization_settings: { findUnique: jest.fn(async () => null) },
    stores: { findMany: jest.fn(async () => [{ id: 1 }]) },
    users: {
      findFirst: jest.fn(async ({ where }: Row) =>
        where.organization_id === 1 && [10, 11].includes(where.id) ? { id: where.id } : null,
      ),
    },
    user_roles: {
      // Ana (10) owner org-wide, Beto (11) admin de la tienda 1, Carla (12) admin de la tienda 2.
      findMany: jest.fn(async ({ where }: Row) =>
        [
          { user_id: 10, store_id: null },
          { user_id: 11, store_id: 1 },
          { user_id: 12, store_id: 2 },
        ].filter((r) => r.store_id === null || where.OR[1].store_id.in.includes(r.store_id)),
      ),
    },
    fiscal_obligations: {
      findMany: jest.fn(async ({ where }: Row) =>
        obligations.filter((o) => matchesWhere({ ...o, declaration_drafts: {} }, where)).map((o) => ({ ...o })),
      ),
      count: jest.fn(async ({ where }: Row) =>
        obligations.filter((o) => matchesWhere({ ...o, declaration_drafts: {} }, where)).length,
      ),
      update: jest.fn(async ({ where, data }: Row) => {
        const row = obligations.find((o) => o.id === where.id)!;
        Object.assign(row, data);
        return { ...row };
      }),
    },
    user_reminders: {
      findMany: jest.fn(async ({ where }: Row) =>
        reminders.map(withObligation).filter((r) => matchesWhere(r, where)),
      ),
      count: jest.fn(async ({ where }: Row) =>
        reminders.map(withObligation).filter((r) => matchesWhere(r, where)).length,
      ),
      createMany: jest.fn(async ({ data }: Row) => {
        for (const row of data) {
          reminders.push({ status: 'pending', notified_at: null, ...row, id: nextReminderId++ });
        }
        return { count: data.length };
      }),
      update: jest.fn(async ({ where, data }: Row) => {
        Object.assign(reminders.find((r) => r.id === where.id)!, data);
      }),
      deleteMany: jest.fn(async ({ where }: Row) => {
        let count = 0;
        for (let i = reminders.length - 1; i >= 0; i--) {
          if (matchesWhere(reminders[i], where)) {
            reminders.splice(i, 1);
            count++;
          }
        }
        return { count };
      }),
    },
  };

  const deadline = (type: string, dto: Row) => {
    if (!context.accounting_entity.tax_id) {
      return { due_date: null, due_date_verified: false, due_date_source: null, warning: 'NIT missing' };
    }
    const closing = dto.period_month;
    if (dto.period_year === 2027 && published2027[closing]) {
      return {
        due_date: new Date(Date.UTC(2027, closing, published2027[closing])),
        due_date_verified: true,
        due_date_source: 'DIAN 2027',
        warning: null,
      };
    }
    return taxCalendar.resolve({
      type: type as never,
      period_year: dto.period_year,
      period_month: dto.period_month,
      periodicity: dto.periodicity,
      nit: context.accounting_entity.tax_id,
      jurisdiction_key: 'CO-DIAN',
    });
  };

  const obligationsService = {
    previewDeadline: jest.fn(async (_ctx: unknown, type: string, dto: Row) => deadline(type, dto)),
    detectDefaultTypes: jest.fn(async () => options.retention ?? []),
    generateForContext: jest.fn(async (_ctx: unknown, dto: Row) => {
      const type = dto.types[0];
      const range = resolveFiscalPeriodRange(dto as never);
      const calendar = deadline(type, dto);
      const existing = obligations.find(
        (o) =>
          o.type === type &&
          o.period_start.getTime() === range.period_start.getTime() &&
          o.period_end.getTime() === range.period_end.getTime(),
      );
      if (existing) {
        if (dto.force_refresh) {
          Object.assign(existing, {
            due_date: calendar.due_date,
            due_date_verified: calendar.due_date_verified,
            ...(calendar.due_date_verified && existing.status === 'blocked'
              ? { status: 'pending', blocking_reason: null }
              : {}),
          });
        }
        return [{ ...existing }];
      }
      const created = {
        id: nextObligationId++,
        organization_id: 1,
        store_id: 1,
        accounting_entity_id: 7,
        jurisdiction_key: 'CO-DIAN',
        type,
        periodicity: dto.periodicity,
        ...range,
        due_date: calendar.due_date,
        due_date_verified: calendar.due_date_verified,
        status: calendar.due_date_verified ? 'pending' : 'blocked',
        blocking_reason: calendar.due_date_verified ? null : '[CALENDAR_UNVERIFIED] x',
        notes: null,
      };
      obligations.push(created);
      return [{ ...created }];
    }),
  };
  const audit = { logForResource: jest.fn(async () => undefined) };

  const service = new FiscalCalendarRemindersService(
    prisma as unknown as GlobalPrismaService,
    obligationsService as unknown as FiscalObligationService,
    audit as unknown as FiscalAuditService,
  );

  return {
    service,
    context,
    obligations,
    reminders,
    obligationsService,
    audit,
    setFiscalData: (data: Row) => {
      fiscalData = data;
    },
    publish2027: (closingMonth: number, day: number) => {
      published2027[closingMonth] = day;
    },
  };
}

const isoLocal = (d: Date | null) => (d ? d.toISOString() : null);

describe('FiscalCalendarRemindersService — generación al guardar (F1/F2/F5)', () => {
  it('genera la ventana de IVA y los avisos de 7 y 1 día con enlace a la obligación', async () => {
    const t = setup();

    const result = await t.service.onFiscalDataSaved(t.context, {
      previous_periodicity: undefined,
      saver_user_id: 10,
      now: NOW,
    });

    expect(result).toMatchObject({
      status: 'generated',
      periodicity: 'bimonthly',
      obligations: 3,
      pending_confirmation: 1,
    });
    expect(t.obligations.map((o) => `${o.period_start.toISOString().slice(0, 7)}→${o.status}`)).toEqual([
      '2026-09→pending', // sep-oct, vence 24 nov 2026
      '2026-11→pending', // nov-dic, vence 25 ene 2027 (calendario 2026)
      '2027-01→blocked', // ene-feb 2027: sin calendario DIAN verificado
    ]);

    // Destinatarios: Ana (guarda y es owner) y Beto (admin de la tienda 1), sin duplicar; nunca Carla.
    const ana = t.reminders.filter((r) => r.user_id === 10);
    expect(new Set(t.reminders.map((r) => r.user_id))).toEqual(new Set([10, 11]));
    expect(t.reminders.every((r) => r.store_id === 1)).toBe(true);
    expect(result.reminders_created).toBe(8);

    // 24 nov: el de 7 días (17 nov) ya pasó; solo queda el del día anterior.
    expect(ana.map((r) => [r.title, isoLocal(r.remind_at)])).toEqual([
      ['IVA bimestral sep-oct 2026 · vence 24 nov', '2026-11-23T13:00:00.000Z'],
      ['IVA bimestral nov-dic 2026 · vence 25 ene 2027', '2027-01-18T13:00:00.000Z'],
      ['IVA bimestral nov-dic 2026 · vence 25 ene 2027', '2027-01-24T13:00:00.000Z'],
      ['IVA bimestral ene-feb 2027 · fecha por confirmar (calendario DIAN aún no publicado)', null],
    ]);
    const first = ana[0];
    expect(first).toMatchObject({
      source: 'fiscal',
      link_type: 'fiscal_obligation',
      link_id: t.obligations[0].id,
      fiscal_obligation_id: t.obligations[0].id,
      link_label: 'IVA bimestral sep-oct 2026',
    });
    expect(first.note).toContain('Mañana vence');
  });

  it('es idempotente: guardar dos veces no duplica obligaciones ni avisos', async () => {
    const t = setup();
    await t.service.onFiscalDataSaved(t.context, { previous_periodicity: null, saver_user_id: 10, now: NOW });
    const before = t.reminders.length;

    const again = await t.service.onFiscalDataSaved(t.context, {
      previous_periodicity: 'bimonthly',
      saver_user_id: 10,
      now: NOW,
    });

    expect(t.reminders).toHaveLength(before);
    expect(t.obligations).toHaveLength(3);
    expect(again.reminders_created).toBe(0);
    expect(again.message).toContain('ya están al día');
  });

  it('sin NIT no genera nada y lo dice', async () => {
    const t = setup({ nit: null });

    const result = await t.service.onFiscalDataSaved(t.context, {
      previous_periodicity: null,
      saver_user_id: 10,
      now: NOW,
    });

    expect(result.status).toBe('missing_nit');
    expect(result.message).toContain('falta el NIT');
    expect(t.obligationsService.generateForContext).not.toHaveBeenCalled();
    expect(t.reminders).toHaveLength(0);
  });

  it('sin periodicidad configurada no hace nada', async () => {
    const t = setup({ fiscalData: { ...RESPONSIBLE } });
    const result = await t.service.syncContext(t.context, { now: NOW, mode: 'save' });
    expect(result.status).toBe('no_periodicity');
    expect(t.obligationsService.generateForContext).not.toHaveBeenCalled();
  });

  it('un superadmin que guarda la identidad del tenant no recibe avisos (no pertenece a la organización)', async () => {
    const t = setup();
    await t.service.onFiscalDataSaved(t.context, { previous_periodicity: null, saver_user_id: 999, now: NOW });
    expect(t.reminders.some((r) => r.user_id === 999)).toBe(false);
  });

  it('incluye la retención mensual solo si la generación automática ya la detecta', async () => {
    const t = setup({ retention: ['withholding_return'] });
    await t.service.syncContext(t.context, { now: NOW, mode: 'save', saver_user_id: 10 });
    const retention = t.obligations.filter((o) => o.type === 'withholding_return');
    // Oct (vence 24 nov con NIT 9) y nov (vence dic).
    expect(retention.map((o) => o.period_start.toISOString().slice(0, 7))).toEqual(['2026-10', '2026-11']);
    expect(t.reminders.some((r) => r.title.startsWith('Retención en la fuente oct 2026 · vence'))).toBe(true);
  });
});

describe('FiscalCalendarRemindersService — cambio de periodicidad (F3)', () => {
  async function savedBimonthly() {
    const t = setup();
    await t.service.onFiscalDataSaved(t.context, { previous_periodicity: null, saver_user_id: 10, now: NOW });
    return t;
  }

  it('la vista previa cuenta avisos y obligaciones pendientes de la periodicidad actual', async () => {
    const t = await savedBimonthly();
    const preview = await t.service.previewPeriodicityChange(t.context, 'four_monthly', NOW);
    expect(preview).toEqual({
      current_periodicity: 'bimonthly',
      next_periodicity: 'four_monthly',
      changed: true,
      pending_obligations: 3,
      pending_reminders: 8,
    });
    const same = await t.service.previewPeriodicityChange(t.context, 'bimonthly', NOW);
    expect(same).toMatchObject({ changed: false, pending_reminders: 0 });
  });

  it('reemplazar retira lo pendiente de la anterior, nunca lo presentado, y genera la nueva', async () => {
    const t = await savedBimonthly();
    // sep-oct ya se presentó: no se toca ni pierde sus avisos.
    t.obligations[0].status = 'submitted';
    t.setFiscalData({ ...RESPONSIBLE, vat_periodicity: 'four_monthly' });

    const result = await t.service.onFiscalDataSaved(t.context, {
      previous_periodicity: 'bimonthly',
      saver_user_id: 10,
      decision: 'replace',
      now: NOW,
    });

    expect(result.replaced).toEqual({ obligations_cancelled: 2, reminders_removed: 6 });
    const bimonthly = t.obligations.filter((o) => o.periodicity === 'bimonthly');
    expect(bimonthly.map((o) => o.status)).toEqual(['submitted', 'cancelled', 'cancelled']);
    expect(bimonthly[1].notes.startsWith(CALENDAR_REPLACED_MARKER)).toBe(true);
    expect(t.reminders.filter((r) => r.fiscal_obligation_id === bimonthly[0].id)).toHaveLength(2);

    const four = t.obligations.filter((o) => o.periodicity === 'four_monthly');
    // may-ago ya venció (sep): ventana = sep-dic 2026 + ene-abr 2027.
    expect(four.map((o) => o.period_start.toISOString().slice(0, 7))).toEqual(['2026-09', '2027-01']);
    expect(t.reminders.some((r) => r.title === 'IVA cuatrimestral sep-dic 2026 · vence 25 ene 2027')).toBe(true);
    expect(result.message).toContain('Se retiraron 6 recordatorios');
    expect(t.audit.logForResource).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'cancelled' }),
      expect.objectContaining({ metadata: expect.objectContaining({ reason: 'vat_periodicity_changed' }) }),
    );
  });

  it('conservar deja todo lo anterior y agrega la nueva periodicidad', async () => {
    const t = await savedBimonthly();
    t.setFiscalData({ ...RESPONSIBLE, vat_periodicity: 'four_monthly' });

    const result = await t.service.onFiscalDataSaved(t.context, {
      previous_periodicity: 'bimonthly',
      saver_user_id: 10,
      decision: 'keep',
      now: NOW,
    });

    expect(result.replaced).toBeNull();
    expect(t.obligations.filter((o) => o.periodicity === 'bimonthly').every((o) => o.status !== 'cancelled')).toBe(true);
    expect(t.obligations.filter((o) => o.periodicity === 'four_monthly')).toHaveLength(2);
  });

  it('volver a la periodicidad anterior reactiva las obligaciones que se cancelaron al cambiarla', async () => {
    const t = await savedBimonthly();
    t.setFiscalData({ ...RESPONSIBLE, vat_periodicity: 'four_monthly' });
    await t.service.onFiscalDataSaved(t.context, {
      previous_periodicity: 'bimonthly',
      decision: 'replace',
      saver_user_id: 10,
      now: NOW,
    });
    t.setFiscalData({ ...RESPONSIBLE, vat_periodicity: 'bimonthly' });

    await t.service.onFiscalDataSaved(t.context, {
      previous_periodicity: 'four_monthly',
      decision: 'replace',
      saver_user_id: 10,
      now: NOW,
    });

    const bimonthly = t.obligations.filter((o) => o.periodicity === 'bimonthly');
    expect(bimonthly.map((o) => o.status)).toEqual(['pending', 'pending', 'blocked']);
    expect(bimonthly.every((o) => o.notes === null)).toBe(true);
    expect(t.reminders.filter((r) => r.fiscal_obligation_id === bimonthly[1].id)).toHaveLength(4);
  });
});

describe('FiscalCalendarRemindersService — job diario (F4/F5)', () => {
  it('asigna la fecha oficial al aviso «por confirmar» cuando la DIAN publica el calendario', async () => {
    const t = setup();
    await t.service.onFiscalDataSaved(t.context, { previous_periodicity: null, saver_user_id: 10, now: NOW });
    const janFeb = t.obligations[2];
    expect(t.reminders.filter((r) => r.fiscal_obligation_id === janFeb.id && r.remind_at === null)).toHaveLength(2);

    // Sale el calendario 2027: ene-feb vence el 24 de marzo.
    t.publish2027(2, 24);
    const result = await t.service.syncContext(t.context, { now: NOW, mode: 'job' });

    expect(janFeb.status).toBe('pending');
    expect(janFeb.due_date_verified).toBe(true);
    expect(t.obligationsService.generateForContext).toHaveBeenCalledWith(
      t.context,
      expect.objectContaining({ period_year: 2027, period_month: 2, force_refresh: true }),
    );
    const ana = t.reminders.filter((r) => r.fiscal_obligation_id === janFeb.id && r.user_id === 10);
    expect(ana.map((r) => [r.title, isoLocal(r.remind_at)])).toEqual([
      ['IVA bimestral ene-feb 2027 · vence 24 mar', '2027-03-17T13:00:00.000Z'],
      ['IVA bimestral ene-feb 2027 · vence 24 mar', '2027-03-23T13:00:00.000Z'],
    ]);
    expect(result).toMatchObject({ reminders_scheduled: 2, reminders_created: 2 });
  });

  it('rueda la ventana: crea el siguiente periodo y no recrea avisos borrados a mano', async () => {
    const t = setup();
    await t.service.onFiscalDataSaved(t.context, { previous_periodicity: null, saver_user_id: 10, now: NOW });
    // Beto borra su aviso de nov-dic: el job no debe devolverlo.
    const novDec = t.obligations[1];
    const betoNovDec = t.reminders.filter((r) => r.fiscal_obligation_id === novDec.id && r.user_id === 11);
    for (const r of betoNovDec) t.reminders.splice(t.reminders.indexOf(r), 1);

    // 27 ene 2027: nov-dic ya venció; ventana = ene-feb 2027 + mar-abr 2027 (nuevo).
    await t.service.syncContext(t.context, { now: new Date('2027-01-27T15:00:00Z'), mode: 'job' });

    expect(t.obligations.map((o) => o.period_start.toISOString().slice(0, 7))).toEqual([
      '2026-09',
      '2026-11',
      '2027-01',
      '2027-03',
    ]);
    const marApr = t.obligations[3];
    // El nuevo periodo llega a quienes ya recibían avisos de la entidad.
    expect(
      t.reminders.filter((r) => r.fiscal_obligation_id === marApr.id).map((r) => r.user_id).sort(),
    ).toEqual([10, 11]);
    expect(t.reminders.filter((r) => r.fiscal_obligation_id === novDec.id && r.user_id === 11)).toHaveLength(0);
  });
});
