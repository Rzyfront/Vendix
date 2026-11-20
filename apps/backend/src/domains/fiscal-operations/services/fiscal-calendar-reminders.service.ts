import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  fiscal_obligation_status_enum,
  fiscal_obligation_type_enum,
  fiscal_obligations,
  Prisma,
} from '@prisma/client';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { isVatResponsible } from '@common/helpers/vat-responsibility.helper';
import { tryResolveTenantFiscalIdentity } from '@common/helpers/fiscal-identity.helper';
import {
  localCivil,
  resolveStoreTimezone,
  zonedWallClockToUtc,
} from '@common/utils/store-timezone.util';
import { VatPeriodicity } from '../constants/fiscal-responsibilities.catalog';
import { FiscalOperationsContext } from './fiscal-context-resolver.service';
import { FiscalObligationService } from './fiscal-obligation.service';
import { FiscalAuditService } from './fiscal-audit.service';
import { resolveFiscalPeriodRange } from './fiscal-period.util';
import {
  FiscalCalendarPeriodRef,
  normalizeVatPeriodicity,
  vatWindowCandidates,
} from './fiscal-calendar-window.util';
import {
  fiscalDueLongLabel,
  fiscalDueShortLabel,
  fiscalObligationLabel,
} from './fiscal-calendar-labels.util';

/** Zona de la ventana del calendario (los vencimientos DIAN son fechas civiles de Colombia). */
export const FISCAL_CALENDAR_TIMEZONE = 'America/Bogota';
/** Días antes del vencimiento en que llega cada aviso. */
export const FISCAL_REMINDER_OFFSETS_DAYS = [7, 1] as const;
/** Hora local de la tienda a la que suena cada aviso. */
const FISCAL_REMINDER_HOUR = 8;
/** Roles que reciben los avisos del calendario en cada tienda. */
const FISCAL_REMINDER_ROLES = ['owner', 'admin'];
/**
 * Marca de las obligaciones canceladas por un cambio de periodicidad: si la
 * persona vuelve a la periodicidad anterior, la sincronización las reactiva en
 * vez de dejar el periodo sin obligación (el estado `cancelled` es terminal).
 */
export const CALENDAR_REPLACED_MARKER = '[CALENDAR_REPLACED]';
const CALENDAR_BLOCK_PREFIX = '[CALENDAR_UNVERIFIED]';
const PENDING_DATE_TEXT = 'fecha por confirmar (calendario DIAN aún no publicado)';
const RETENTION_TYPES: fiscal_obligation_type_enum[] = [
  'withholding_return',
  'reteiva_return',
];
/** Obligaciones ya iniciadas/cerradas: nunca se tocan ni reciben avisos nuevos. */
const CLOSED_STATUSES: fiscal_obligation_status_enum[] = [
  'approved',
  'submitted',
  'accepted',
  'paid',
  'not_applicable',
];
const MINUTE_MS = 60_000;

export type FiscalCalendarChangeDecision = 'replace' | 'keep';

export type FiscalCalendarSyncStatus =
  | 'generated'
  | 'missing_nit'
  | 'invalid_nit'
  | 'no_periodicity'
  | 'not_vat_responsible'
  | 'error';

export interface FiscalCalendarSyncResult {
  status: FiscalCalendarSyncStatus;
  periodicity: VatPeriodicity | null;
  /** Obligaciones dentro de la ventana (nuevas o existentes). */
  obligations: number;
  reminders_created: number;
  /** Recordatorios «fecha por confirmar» que recibieron la fecha oficial. */
  reminders_scheduled: number;
  /** Obligaciones de la ventana sin fecha oficial (calendario DIAN no publicado). */
  pending_confirmation: number;
  replaced: { obligations_cancelled: number; reminders_removed: number } | null;
  /** Texto para la persona (español neutro). */
  message: string;
}

export interface FiscalCalendarChangePreview {
  current_periodicity: VatPeriodicity | null;
  next_periodicity: VatPeriodicity | null;
  changed: boolean;
  pending_reminders: number;
  pending_obligations: number;
}

interface Recipient {
  store_id: number;
  user_id: number;
}

interface SyncOptions {
  now?: Date;
  /** Quien guardó la configuración: recibe los avisos además de owners/admins. */
  saver_user_id?: number | null;
  /**
   * `save`: crea los avisos que falten en toda la ventana (acción explícita).
   * `job`: solo crea avisos para obligaciones nuevas y asigna fecha a los
   * «fecha por confirmar»; un aviso borrado a mano no reaparece cada día.
   */
  mode: 'save' | 'job';
}

interface ContextFiscalData {
  vat_periodicity?: unknown;
  tax_responsibilities?: unknown;
  tax_regime?: unknown;
  [key: string]: unknown;
}

interface WindowTarget {
  type: fiscal_obligation_type_enum;
  periodicity: VatPeriodicity;
  ref: FiscalCalendarPeriodRef;
}

/**
 * Calendario tributario → recordatorios en la bitácora (F1-F5).
 *
 * Con la periodicidad de IVA configurada, asegura las obligaciones de la
 * ventana (último periodo cerrado mientras no venza + periodo en curso +
 * siguiente) con `FiscalObligationService.generateForContext` — la misma
 * lógica del botón del Centro Fiscal — y por cada una crea en la bitácora de
 * los responsables los avisos de 7 días y 1 día antes del vencimiento oficial.
 * Sin fecha oficial (calendario DIAN no publicado) crea un aviso sin fecha que
 * no notifica, y el job diario le asigna la fecha cuando el calendario la
 * resuelve. Nunca inventa fechas ni toca obligaciones ya presentadas/pagadas.
 *
 * Destinatarios (`user_reminders` exige tienda + usuario): quien guarda la
 * configuración + owners/admins de cada tienda de la entidad fiscal (con
 * fiscal_scope ORGANIZATION, todas las tiendas activas de la organización) +
 * quienes ya recibían avisos de esa entidad. Sin duplicados.
 */
@Injectable()
export class FiscalCalendarRemindersService {
  private readonly logger = new Logger(FiscalCalendarRemindersService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly obligations: FiscalObligationService,
    private readonly audit: FiscalAuditService,
  ) {}

  // ── API pública ─────────────────────────────────────────────

  /**
   * Hook posterior al guardado de los datos fiscales. `decision` solo aplica
   * cuando cambió la periodicidad: `replace` cancela lo pendiente de la
   * anterior; sin decisión (o `keep`) se conserva todo (no destructivo).
   */
  async onFiscalDataSaved(
    context: FiscalOperationsContext,
    input: {
      previous_periodicity: unknown;
      saver_user_id?: number | null;
      decision?: FiscalCalendarChangeDecision | null;
      now?: Date;
    },
  ): Promise<FiscalCalendarSyncResult> {
    const fiscalData = await this.fiscalDataFor(context);
    const previous = normalizeVatPeriodicity(input.previous_periodicity);
    const next = normalizeVatPeriodicity(fiscalData?.vat_periodicity);
    const now = input.now ?? new Date();

    let replaced: FiscalCalendarSyncResult['replaced'] = null;
    if (previous && next && previous !== next && input.decision === 'replace') {
      replaced = await this.replacePeriodicity(context, previous, next, now);
    }

    const result = await this.syncContext(context, {
      now,
      saver_user_id: input.saver_user_id ?? null,
      mode: 'save',
    });
    return { ...result, replaced, message: this.messageFor({ ...result, replaced }) };
  }

  /** Cuántos avisos/obligaciones pendientes de la periodicidad actual se verían afectados. */
  async previewPeriodicityChange(
    context: FiscalOperationsContext,
    nextValue: unknown,
    now: Date = new Date(),
  ): Promise<FiscalCalendarChangePreview> {
    const fiscalData = await this.fiscalDataFor(context);
    const current = normalizeVatPeriodicity(fiscalData?.vat_periodicity);
    const next = normalizeVatPeriodicity(nextValue);
    const changed = !!current && !!next && current !== next;
    if (!changed) {
      return {
        current_periodicity: current,
        next_periodicity: next,
        changed: false,
        pending_reminders: 0,
        pending_obligations: 0,
      };
    }

    const where = this.replaceableWhere(context, current!, now);
    const [pending_obligations, pending_reminders] = await Promise.all([
      this.prisma.fiscal_obligations.count({ where }),
      this.prisma.user_reminders.count({
        where: { source: 'fiscal', status: 'pending', fiscal_obligation: where },
      }),
    ]);
    return {
      current_periodicity: current,
      next_periodicity: next,
      changed,
      pending_reminders,
      pending_obligations,
    };
  }

  /** Núcleo idempotente: ventana → obligaciones → avisos. */
  async syncContext(
    context: FiscalOperationsContext,
    options: SyncOptions,
  ): Promise<FiscalCalendarSyncResult> {
    const now = options.now ?? new Date();
    const fiscalData = await this.fiscalDataFor(context);
    const periodicity = normalizeVatPeriodicity(fiscalData?.vat_periodicity);
    const base: FiscalCalendarSyncResult = {
      status: 'generated',
      periodicity,
      obligations: 0,
      reminders_created: 0,
      reminders_scheduled: 0,
      pending_confirmation: 0,
      replaced: null,
      message: '',
    };

    if (!periodicity) return this.finish({ ...base, status: 'no_periodicity' });
    if (!this.nitFor(context, fiscalData)) {
      return this.finish({ ...base, status: 'missing_nit' });
    }
    if (!isVatResponsible(fiscalData as never)) {
      return this.finish({ ...base, status: 'not_vat_responsible' });
    }

    const civil = localCivil(now, FISCAL_CALENDAR_TIMEZONE);
    const today = new Date(Date.UTC(civil.year, civil.month - 1, civil.day));

    try {
      const targets = [
        ...(await this.vatTargets(context, periodicity, civil, today)),
        ...(await this.retentionTargets(context, civil, today)),
      ];
      if (!targets.length) return this.finish(base);

      const existing = await this.existingObligations(context, targets);
      const recipients = await this.recipientsFor(context, options.saver_user_id ?? null);
      const timezones = new Map<number, string>();

      for (const target of targets) {
        const range = resolveFiscalPeriodRange({
          period_year: target.ref.period_year,
          period_month: target.ref.period_month,
          periodicity: target.periodicity,
        });
        const current = existing.find(
          (o) =>
            o.type === target.type &&
            o.period_start.getTime() === range.period_start.getTime() &&
            o.period_end.getTime() === range.period_end.getTime(),
        );
        if (current && CLOSED_STATUSES.includes(current.status)) continue;
        if (
          current?.status === 'cancelled' &&
          !current.notes?.startsWith(CALENDAR_REPLACED_MARKER)
        ) {
          // Cancelada a mano: decisión de la persona, no se reabre.
          continue;
        }

        const obligation = await this.ensureObligation(context, target, current ?? null);
        base.obligations++;
        if (!obligation.due_date_verified) base.pending_confirmation++;

        const counts = await this.ensureReminders(
          obligation,
          recipients,
          options.mode === 'save' || !current ? 'full' : 'upgrade_only',
          now,
          timezones,
        );
        base.reminders_created += counts.created;
        base.reminders_scheduled += counts.scheduled;
      }
      return this.finish(base);
    } catch (error) {
      if (error instanceof BadRequestException && /NIT/.test(error.message)) {
        return this.finish({ ...base, status: 'invalid_nit' });
      }
      this.logger.error(
        `Fiscal calendar sync failed for entity ${context.accounting_entity_id}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      return this.finish({ ...base, status: 'error' });
    }
  }

  // ── Cambio de periodicidad (F3) ─────────────────────────────

  private replaceableWhere(
    context: FiscalOperationsContext,
    periodicity: VatPeriodicity,
    now: Date,
  ): Prisma.fiscal_obligationsWhereInput {
    const civil = localCivil(now, FISCAL_CALENDAR_TIMEZONE);
    const today = new Date(Date.UTC(civil.year, civil.month - 1, civil.day));
    return {
      organization_id: context.organization_id,
      accounting_entity_id: context.accounting_entity_id,
      jurisdiction_key: 'CO-DIAN',
      type: 'vat_return',
      periodicity,
      // Solo lo NO iniciado: ni en progreso, ni lista, ni presentada/pagada.
      status: { in: ['pending', 'blocked'] },
      // Con un borrador de declaración ya hay trabajo hecho: no se toca.
      declaration_drafts: { none: {} },
      OR: [{ due_date: null }, { due_date: { gte: today } }],
    };
  }

  private async replacePeriodicity(
    context: FiscalOperationsContext,
    previous: VatPeriodicity,
    next: VatPeriodicity,
    now: Date,
  ) {
    const stale = await this.prisma.fiscal_obligations.findMany({
      where: this.replaceableWhere(context, previous, now),
    });
    if (!stale.length) return { obligations_cancelled: 0, reminders_removed: 0 };

    const ids = stale.map((o) => o.id);
    // Primero los avisos pendientes (los completados quedan como historial).
    const removed = await this.prisma.user_reminders.deleteMany({
      where: { fiscal_obligation_id: { in: ids }, source: 'fiscal', status: 'pending' },
    });

    for (const obligation of stale) {
      const updated = await this.prisma.fiscal_obligations.update({
        where: { id: obligation.id },
        data: {
          status: 'cancelled',
          notes: `${CALENDAR_REPLACED_MARKER} Reemplazada al cambiar la periodicidad de IVA (${previous} → ${next}).`,
        },
      });
      await this.audit.logForResource(updated, {
        event_type: 'fiscal.obligation.status_changed',
        resource_type: 'fiscal_obligation',
        obligation_id: updated.id,
        previous_status: obligation.status,
        new_status: 'cancelled',
        metadata: {
          reason: 'vat_periodicity_changed',
          previous_periodicity: previous,
          next_periodicity: next,
        },
      });
    }
    return { obligations_cancelled: stale.length, reminders_removed: removed.count };
  }

  // ── Ventana (F1/F4) ─────────────────────────────────────────

  private async vatTargets(
    context: FiscalOperationsContext,
    periodicity: VatPeriodicity,
    civil: { year: number; month: number },
    today: Date,
  ): Promise<WindowTarget[]> {
    const { last_closed, current, next } = vatWindowCandidates(periodicity, civil);
    const targets: WindowTarget[] = [];
    if (!(await this.deadlinePassed(context, 'vat_return', periodicity, last_closed, today))) {
      targets.push({ type: 'vat_return', periodicity, ref: last_closed });
    }
    targets.push({ type: 'vat_return', periodicity, ref: current });
    targets.push({ type: 'vat_return', periodicity, ref: next });
    return targets;
  }

  /**
   * Retención mensual solo cuando la generación automática ya la incluye
   * (retenciones practicadas en el mes): mes anterior mientras no venza y mes
   * en curso. Nunca se inventa una obligación que el comercio no tiene.
   */
  private async retentionTargets(
    context: FiscalOperationsContext,
    civil: { year: number; month: number },
    today: Date,
  ): Promise<WindowTarget[]> {
    const { last_closed, current } = vatWindowCandidates('monthly', civil);
    const targets: WindowTarget[] = [];
    for (const ref of [last_closed, current]) {
      let detected: fiscal_obligation_type_enum[] = [];
      try {
        detected = await this.obligations.detectDefaultTypes(context, {
          ...ref,
          periodicity: 'monthly',
        });
      } catch (error) {
        this.logger.warn(
          `Retention detection skipped for entity ${context.accounting_entity_id}: ${(error as Error).message}`,
        );
        continue;
      }
      for (const type of RETENTION_TYPES.filter((t) => detected.includes(t))) {
        if (await this.deadlinePassed(context, type, 'monthly', ref, today)) continue;
        targets.push({ type, periodicity: 'monthly', ref });
      }
    }
    return targets;
  }

  /** Vencido = fecha oficial verificada anterior a hoy. Sin fecha oficial nunca está vencido. */
  private async deadlinePassed(
    context: FiscalOperationsContext,
    type: fiscal_obligation_type_enum,
    periodicity: VatPeriodicity,
    ref: FiscalCalendarPeriodRef,
    today: Date,
  ): Promise<boolean> {
    const deadline = await this.obligations.previewDeadline(context, type, {
      ...ref,
      periodicity,
    });
    return (
      deadline.due_date_verified &&
      !!deadline.due_date &&
      deadline.due_date.getTime() < today.getTime()
    );
  }

  private async existingObligations(
    context: FiscalOperationsContext,
    targets: WindowTarget[],
  ): Promise<fiscal_obligations[]> {
    return this.prisma.fiscal_obligations.findMany({
      where: {
        organization_id: context.organization_id,
        accounting_entity_id: context.accounting_entity_id,
        jurisdiction_key: 'CO-DIAN',
        OR: targets.map((t) => {
          const range = resolveFiscalPeriodRange({ ...t.ref, periodicity: t.periodicity });
          return {
            type: t.type,
            period_start: range.period_start,
            period_end: range.period_end,
          };
        }),
      },
    });
  }

  /**
   * Crea o reutiliza la obligación con `generateForContext` (misma lógica del
   * botón manual). Solo fuerza refresco cuando una obligación bloqueada por
   * calendario ya tiene fecha oficial (F5), para no ensuciar la auditoría con
   * un «refrescada» diario.
   */
  private async ensureObligation(
    context: FiscalOperationsContext,
    target: WindowTarget,
    current: fiscal_obligations | null,
  ): Promise<fiscal_obligations> {
    const dto = {
      period_year: target.ref.period_year,
      period_month: target.ref.period_month,
      periodicity: target.periodicity,
    };

    if (current?.status === 'cancelled') {
      return this.reactivate(context, target, current);
    }

    let forceRefresh = false;
    if (current && !current.due_date_verified) {
      const deadline = await this.obligations.previewDeadline(context, target.type, dto);
      forceRefresh = deadline.due_date_verified;
    }
    const [obligation] = await this.obligations.generateForContext(context, {
      ...dto,
      types: [target.type],
      force_refresh: forceRefresh,
    });
    return obligation as fiscal_obligations;
  }

  /** Vuelve a la periodicidad anterior: reabre la obligación que se canceló al cambiarla. */
  private async reactivate(
    context: FiscalOperationsContext,
    target: WindowTarget,
    current: fiscal_obligations,
  ): Promise<fiscal_obligations> {
    const deadline = await this.obligations.previewDeadline(context, target.type, {
      ...target.ref,
      periodicity: target.periodicity,
    });
    const updated = await this.prisma.fiscal_obligations.update({
      where: { id: current.id },
      data: {
        status: deadline.due_date_verified ? 'pending' : 'blocked',
        blocking_reason: deadline.due_date_verified
          ? null
          : `${CALENDAR_BLOCK_PREFIX} ${deadline.warning ?? 'A verified fiscal deadline is not configured.'}`,
        notes: null,
        periodicity: target.periodicity,
        due_date: deadline.due_date,
        due_date_verified: deadline.due_date_verified,
        due_date_source: deadline.due_date_source,
      },
    });
    await this.audit.logForResource(updated, {
      event_type: 'fiscal.obligation.status_changed',
      resource_type: 'fiscal_obligation',
      obligation_id: updated.id,
      previous_status: current.status,
      new_status: updated.status,
      metadata: { reason: 'vat_periodicity_restored', periodicity: target.periodicity },
    });
    return updated;
  }

  // ── Avisos en la bitácora ───────────────────────────────────

  private async ensureReminders(
    obligation: fiscal_obligations,
    recipients: Recipient[],
    mode: 'full' | 'upgrade_only',
    now: Date,
    timezones: Map<number, string>,
  ): Promise<{ created: number; scheduled: number }> {
    if (!recipients.length) return { created: 0, scheduled: 0 };
    const existing = await this.prisma.user_reminders.findMany({
      where: { fiscal_obligation_id: obligation.id, source: 'fiscal' },
      select: { id: true, store_id: true, user_id: true, remind_at: true, status: true },
    });
    const byRecipient = new Map<string, typeof existing>();
    for (const row of existing) {
      const key = `${row.store_id}:${row.user_id}`;
      byRecipient.set(key, [...(byRecipient.get(key) ?? []), row]);
    }

    const label = fiscalObligationLabel(obligation);
    const verified = obligation.due_date_verified && !!obligation.due_date;
    const toCreate: Prisma.user_remindersCreateManyInput[] = [];
    let scheduled = 0;

    for (const recipient of recipients) {
      const rows = byRecipient.get(`${recipient.store_id}:${recipient.user_id}`) ?? [];

      if (!verified) {
        // F5: un solo aviso sin fecha; no notifica hasta tener la oficial.
        if (!rows.length && mode === 'full') {
          toCreate.push(this.reminderData(obligation, recipient, label, null, null));
        }
        continue;
      }

      const placeholders = rows.filter((r) => r.remind_at === null && r.status === 'pending');
      if (mode === 'upgrade_only' && !placeholders.length) continue;

      const tz = await this.timezoneFor(recipient.store_id, timezones);
      const desired = this.desiredDates(obligation.due_date!, tz, now).filter(
        (d) =>
          !rows.some(
            (r) =>
              r.remind_at &&
              Math.floor(r.remind_at.getTime() / MINUTE_MS) ===
                Math.floor(d.at.getTime() / MINUTE_MS),
          ),
      );
      for (const date of desired) {
        const placeholder = placeholders.shift();
        if (placeholder) {
          const data = this.reminderData(obligation, recipient, label, date.at, date.offset);
          await this.prisma.user_reminders.update({
            where: { id: placeholder.id },
            data: {
              title: data.title,
              note: data.note,
              remind_at: data.remind_at,
              link_label: data.link_label,
              notified_at: null,
            },
          });
          scheduled++;
        } else {
          toCreate.push(this.reminderData(obligation, recipient, label, date.at, date.offset));
        }
      }
    }

    if (toCreate.length) {
      await this.prisma.user_reminders.createMany({ data: toCreate });
    }
    return { created: toCreate.length, scheduled };
  }

  /** 7 y 1 día antes, 08:00 hora de la tienda; solo los que aún no pasaron. */
  private desiredDates(dueDate: Date, tz: string, now: Date) {
    return FISCAL_REMINDER_OFFSETS_DAYS.map((offset) => ({
      offset,
      at: zonedWallClockToUtc(
        dueDate.getUTCFullYear(),
        dueDate.getUTCMonth() + 1,
        dueDate.getUTCDate() - offset,
        FISCAL_REMINDER_HOUR,
        0,
        0,
        0,
        tz,
      ),
    })).filter((d) => d.at.getTime() > now.getTime());
  }

  private reminderData(
    obligation: fiscal_obligations,
    recipient: Recipient,
    label: string,
    remindAt: Date | null,
    offset: number | null,
  ): Prisma.user_remindersCreateManyInput {
    const due = obligation.due_date_verified ? obligation.due_date : null;
    const title = due
      ? `${label} · vence ${fiscalDueShortLabel(due, obligation.period_end)}`
      : `${label} · ${PENDING_DATE_TEXT}`;
    const note = !due
      ? 'La DIAN aún no publica el calendario de este vencimiento. Este aviso recibirá la fecha oficial en cuanto esté disponible; mientras tanto no te enviará notificaciones.'
      : offset === 1
        ? `Mañana vence la declaración de ${label} (${fiscalDueLongLabel(due)}, calendario DIAN). Abre el enlace para preparar el reporte del periodo.`
        : `Faltan ${offset ?? 7} días para la declaración de ${label}: vence el ${fiscalDueLongLabel(due)} (calendario DIAN). Abre el enlace para preparar el reporte del periodo.`;
    return {
      store_id: recipient.store_id,
      user_id: recipient.user_id,
      title: title.slice(0, 200),
      note: note.slice(0, 500),
      remind_at: remindAt,
      source: 'fiscal',
      link_type: 'fiscal_obligation',
      link_id: obligation.id,
      link_label: label.slice(0, 200),
      fiscal_obligation_id: obligation.id,
    };
  }

  private async timezoneFor(storeId: number, cache: Map<number, string>) {
    if (!cache.has(storeId)) {
      cache.set(
        storeId,
        await resolveStoreTimezone(this.prisma as unknown as StorePrismaService, storeId),
      );
    }
    return cache.get(storeId)!;
  }

  // ── Destinatarios ───────────────────────────────────────────

  private async recipientsFor(
    context: FiscalOperationsContext,
    saverUserId: number | null,
  ): Promise<Recipient[]> {
    const storeIds = context.store_id
      ? [context.store_id]
      : (
          await this.prisma.stores.findMany({
            where: { organization_id: context.organization_id, is_active: true },
            select: { id: true },
            orderBy: { id: 'asc' },
          })
        ).map((s) => s.id);
    if (!storeIds.length) return [];

    // Quien guarda recibe avisos solo si pertenece a la organización (un
    // superadmin que edita la identidad de un tenant no los recibe).
    const saver = saverUserId
      ? await this.prisma.users.findFirst({
          where: { id: saverUserId, organization_id: context.organization_id },
          select: { id: true },
        })
      : null;

    const [admins, previous] = await Promise.all([
      this.prisma.user_roles.findMany({
        where: {
          roles: { name: { in: FISCAL_REMINDER_ROLES } },
          OR: [{ store_id: null }, { store_id: { in: storeIds } }],
          users: {
            organization_id: context.organization_id,
            state: { notIn: ['archived', 'suspended', 'inactive'] },
          },
        },
        select: { user_id: true, store_id: true },
      }),
      this.prisma.user_reminders.findMany({
        where: {
          source: 'fiscal',
          store_id: { in: storeIds },
          fiscal_obligation: { accounting_entity_id: context.accounting_entity_id },
        },
        select: { store_id: true, user_id: true },
        distinct: ['store_id', 'user_id'],
      }),
    ]);

    const seen = new Set<string>();
    const out: Recipient[] = [];
    const add = (store_id: number, user_id: number | null | undefined) => {
      if (!user_id) return;
      const key = `${store_id}:${user_id}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ store_id, user_id });
    };
    for (const storeId of storeIds) {
      add(storeId, saver?.id);
      for (const admin of admins) {
        if (admin.store_id === null || admin.store_id === storeId) add(storeId, admin.user_id);
      }
    }
    for (const row of previous) add(row.store_id, row.user_id);
    return out;
  }

  // ── Datos fiscales ──────────────────────────────────────────

  private async fiscalDataFor(
    context: FiscalOperationsContext,
  ): Promise<ContextFiscalData | null> {
    const row =
      context.fiscal_scope === 'ORGANIZATION'
        ? await this.prisma.organization_settings.findUnique({
            where: { organization_id: context.organization_id },
            select: { settings: true },
          })
        : context.store_id
          ? await this.prisma.store_settings.findUnique({
              where: { store_id: context.store_id },
              select: { settings: true },
            })
          : null;
    const settings = row?.settings;
    const fiscalData =
      settings && typeof settings === 'object' && 'fiscal_data' in settings
        ? (settings as Record<string, unknown>).fiscal_data
        : null;
    return fiscalData && typeof fiscalData === 'object'
      ? (fiscalData as ContextFiscalData)
      : null;
  }

  private nitFor(
    context: FiscalOperationsContext,
    fiscalData: ContextFiscalData | null,
  ): string | null {
    const identity = tryResolveTenantFiscalIdentity({
      nit: context.accounting_entity?.tax_id ?? '',
      fiscal_data: fiscalData as Record<string, unknown> | null,
      entity: context.accounting_entity,
    }).identity;
    return identity.nit ? String(identity.nit) : null;
  }

  // ── Mensajes ────────────────────────────────────────────────

  private finish(result: FiscalCalendarSyncResult): FiscalCalendarSyncResult {
    return { ...result, message: this.messageFor(result) };
  }

  private messageFor(result: FiscalCalendarSyncResult): string {
    switch (result.status) {
      case 'no_periodicity':
        return '';
      case 'missing_nit':
        return 'No se crearon recordatorios del calendario tributario: falta el NIT. Agrégalo y guarda de nuevo.';
      case 'invalid_nit':
        return 'No se crearon recordatorios del calendario tributario: el NIT no tiene un formato válido. Revísalo y guarda de nuevo.';
      case 'not_vat_responsible':
        return 'No se crearon recordatorios de IVA porque el comercio no está marcado como responsable de IVA.';
      case 'error':
        return 'Los datos se guardaron, pero no pudimos crear los recordatorios del calendario tributario. Lo intentaremos de nuevo automáticamente.';
      default: {
        const parts: string[] = [];
        if (result.replaced?.obligations_cancelled) {
          parts.push(
            `Se retiraron ${result.replaced.reminders_removed} recordatorios del calendario anterior.`,
          );
        }
        if (result.reminders_created || result.reminders_scheduled) {
          parts.push(
            `Se agregaron ${result.reminders_created + result.reminders_scheduled} recordatorios a la bitácora con tus próximos vencimientos.`,
          );
        } else if (result.obligations) {
          parts.push('Tus recordatorios del calendario tributario ya están al día.');
        }
        if (result.pending_confirmation) {
          parts.push(
            'Algunos vencimientos quedan con fecha por confirmar hasta que la DIAN publique su calendario.',
          );
        }
        return parts.join(' ');
      }
    }
  }
}
