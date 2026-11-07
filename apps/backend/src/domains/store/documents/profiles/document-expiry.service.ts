import { Injectable, Logger } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { recordTriggerEvent } from '../../workflows/engine/workflow-trigger.outbox';
import { triggerIdempotencyKey } from '../../workflows/engine/workflow-trigger.events';
import { START_EVENT_TYPES, systemIdempotencyKey } from '../../workflows/engine/workflow-idempotency';
import { DEFAULT_STORE_TIMEZONE } from '../../workflows/engine/workflow-stage.service';
import { zonedDatePlus } from '../../workflows/records/workflow-record-fields';
import { loadFileDossiers } from '../search/file-dossier-context';
import { parseDateOnly } from './document-file-profiles.service';

/** Days before the expiry date at which the alert fires. */
export const EXPIRY_ALERT_DAYS = 30;
const DAY_MS = 86_400_000;
const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const daysBetween = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / DAY_MS);

/** "7 de diciembre de 2026" from a `YYYY-MM-DD` date. */
export function longDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} de ${MONTHS[m - 1]} de ${y}`;
}

/** "La póliza <archivo> vence el <fecha> (<N> días)". */
export function expiryMessage(
  docType: string | null,
  fileName: string,
  validUntil: string,
  daysLeft: number,
): string {
  const subject = docType ? `La ${docType.toLowerCase()}` : 'El documento';
  const when = daysLeft <= 0 ? 'hoy' : `${daysLeft} ${daysLeft === 1 ? 'día' : 'días'}`;
  return `${subject} ${fileName} vence el ${longDate(validUntil)} (${when})`;
}

/** Expiry alerts of stored files (P4.6) and the "Por vencer" list. */
@Injectable()
export class DocumentExpiryService {
  private readonly logger = new Logger(DocumentExpiryService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  private ctx() {
    const c = RequestContextService.getContext();
    if (!c?.store_id || !c.organization_id) {
      throw new VendixHttpException(ErrorCodes.DOCUMENT_NOT_FOUND);
    }
    return { store_id: c.store_id };
  }

  private async today(storeId: number, now: Date, plusDays = 0): Promise<string> {
    const store = await this.prisma.stores.findFirst({
      where: { id: storeId },
      select: { timezone: true },
    });
    return zonedDatePlus(now, store?.timezone || DEFAULT_STORE_TIMEZONE, plusDays);
  }

  /**
   * Alerts the files whose `valid_until` falls between today and today + 30
   * (store time zone) and were not alerted for that date yet. Per file, in one
   * transaction: claims `expiry_alerted_for`/`expiry_alerted_at` (so a repeated
   * run or a concurrent worker skips it) and writes the `document.expiring`
   * business event. The in-app notification goes out after the commit. Runs in
   * the store context; returns the number of files alerted.
   */
  async alertDue(now: Date): Promise<number> {
    const c = this.ctx();
    const todayIso = await this.today(c.store_id, now);
    const from = parseDateOnly(todayIso);
    const until = parseDateOnly(await this.today(c.store_id, now, EXPIRY_ALERT_DAYS));
    const profiles: Array<{
      id: number;
      file_id: number;
      doc_type: string | null;
      valid_until: Date;
      expiry_alerted_for: Date | null;
    }> = await this.prisma.document_file_profiles.findMany({
      where: { store_id: c.store_id, valid_until: { gte: from, lte: until } },
      orderBy: [{ valid_until: 'asc' }, { id: 'asc' }],
    });
    const pending = profiles.filter(
      (p) => !p.expiry_alerted_for || p.expiry_alerted_for.getTime() !== p.valid_until.getTime(),
    );
    if (pending.length === 0) return 0;
    const files: Array<{ id: number; original_name: string }> = await this.prisma.stored_files.findMany({
      where: {
        store_id: c.store_id,
        id: { in: pending.map((p) => p.file_id) },
        deleted_at: null,
        purged_at: null,
      },
      select: { id: true, original_name: true },
    });
    const names = new Map(files.map((f) => [f.id, f.original_name]));
    const context = await loadFileDossiers(this.prisma, c.store_id, [...names.keys()]);

    let alerted = 0;
    for (const p of pending) {
      const fileName = names.get(p.file_id);
      if (!fileName) continue;
      try {
        const validUntil = isoDay(p.valid_until);
        const daysLeft = daysBetween(from, p.valid_until);
        const dossier = context.get(p.file_id);
        const payload = {
          store_id: c.store_id,
          file_id: p.file_id,
          file_name: fileName,
          doc_type: p.doc_type,
          valid_until: validUntil,
          days_left: daysLeft,
          dossier_reference: dossier?.dossier_reference ?? null,
          subject_type: dossier?.subject_type ?? null,
          subject_id: dossier?.subject_id ?? null,
        };
        const claimed = await this.prisma.$transaction(async (tx: any) => {
          const { count } = await tx.document_file_profiles.updateMany({
            where: {
              id: p.id,
              store_id: c.store_id,
              valid_until: p.valid_until,
              OR: [
                { expiry_alerted_for: null },
                { expiry_alerted_for: { not: p.valid_until } },
              ],
            },
            data: { expiry_alerted_for: p.valid_until, expiry_alerted_at: now },
          });
          if (count === 0) return false;
          await recordTriggerEvent(tx, 'document.expiring', payload);
          return true;
        });
        if (!claimed) continue;
        alerted++;
        await this.notifications.createAndBroadcast(
          c.store_id,
          'workflow_task',
          'Documento por vencer',
          expiryMessage(p.doc_type, fileName, validUntil, daysLeft),
          {
            kind: 'document_expiring',
            file_id: p.file_id,
            valid_until: validUntil,
            days_left: daysLeft,
            dossier_id: dossier?.dossier_id ?? null,
          },
        );
      } catch (e) {
        this.logger.warn(`Expiry alert of file ${p.file_id} failed: ${(e as Error)?.message}`);
      }
    }
    return alerted;
  }

  /**
   * "Por vencer": live files whose `valid_until` is up to `days` ahead
   * (already expired ones included, with negative `days_left`), soonest first,
   * each with the renewal request the `document.expiring` event started.
   */
  async listExpiring(input: { days?: number; page?: number; limit?: number } = {}, now = new Date()) {
    const c = this.ctx();
    const page = Math.max(1, input.page ?? 1);
    const limit = Math.min(100, Math.max(1, input.limit ?? 20));
    const days = Math.min(365, Math.max(0, input.days ?? EXPIRY_ALERT_DAYS));
    const todayIso = await this.today(c.store_id, now);
    const today = parseDateOnly(todayIso);
    const until = parseDateOnly(await this.today(c.store_id, now, days));
    const where = {
      store_id: c.store_id,
      valid_until: { not: null, lte: until },
      file: { deleted_at: null, purged_at: null },
    };
    const [rows, total] = await Promise.all([
      this.prisma.document_file_profiles.findMany({
        where,
        orderBy: [{ valid_until: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.document_file_profiles.count({ where }),
    ]);
    const profiles = rows as Array<{
      file_id: number;
      doc_type: string | null;
      tags: string[];
      valid_until: Date;
    }>;
    const fileIds = profiles.map((p) => p.file_id);
    const files: Array<{ id: number; original_name: string; legal_hold: boolean }> = fileIds.length
      ? await this.prisma.stored_files.findMany({
          where: { store_id: c.store_id, id: { in: fileIds } },
          select: { id: true, original_name: true, legal_hold: true },
        })
      : [];
    const names = new Map(files.map((f) => [f.id, f.original_name]));
    const holds = new Map(files.map((f) => [f.id, f.legal_hold]));
    const context = await loadFileDossiers(this.prisma, c.store_id, fileIds);
    const renewals = await this.renewals(c.store_id, profiles);
    return {
      data: profiles.map((p) => {
        const iso = isoDay(p.valid_until);
        const dossier = context.get(p.file_id);
        return {
          file_id: p.file_id,
          file_name: names.get(p.file_id) ?? '',
          legal_hold: holds.get(p.file_id) ?? false,
          doc_type: p.doc_type,
          tags: p.tags,
          valid_until: iso,
          days_left: daysBetween(today, p.valid_until),
          dossier: dossier
            ? { id: dossier.dossier_id, reference: dossier.dossier_reference, title: dossier.dossier_title }
            : null,
          subject_type: dossier?.subject_type ?? null,
          subject_id: dossier?.subject_id ?? null,
          renewal: renewals.get(`${p.file_id}:${iso}`) ?? null,
        };
      }),
      total,
      page,
      limit,
    };
  }

  /**
   * Requests started by the `document.expiring` event of each (file, date):
   * the engine stores the start under a key derived from the flow, the event
   * and `file_id:valid_until`, so the key is recomputed here.
   */
  private async renewals(
    storeId: number,
    profiles: Array<{ file_id: number; valid_until: Date }>,
  ) {
    const out = new Map<string, { id: number; reference: string; title: string; status: string }>();
    if (profiles.length === 0) return out;
    const defs: Array<{ id: number }> = await this.prisma.workflow_definitions.findMany({
      where: { store_id: storeId, status: 'active' },
      select: { id: true },
    });
    if (defs.length === 0) return out;
    const keyToBusiness = new Map<string, string>();
    for (const p of profiles) {
      const business = `${p.file_id}:${isoDay(p.valid_until)}`;
      for (const d of defs) {
        keyToBusiness.set(
          systemIdempotencyKey(triggerIdempotencyKey(d.id, 'document.expiring', business)),
          business,
        );
      }
    }
    const events: Array<{ instance_id: number; idempotency_key: string }> =
      await this.prisma.workflow_instance_events.findMany({
        where: {
          store_id: storeId,
          idempotency_key: { in: [...keyToBusiness.keys()] },
          type: { in: START_EVENT_TYPES },
        },
        select: { instance_id: true, idempotency_key: true },
      });
    if (events.length === 0) return out;
    const instances: Array<{ id: number; reference: string; title: string; status: string }> =
      await this.prisma.workflow_instances.findMany({
        where: { store_id: storeId, id: { in: events.map((e) => e.instance_id) } },
        select: { id: true, reference: true, title: true, status: true },
      });
    const byId = new Map(instances.map((i) => [i.id, i]));
    for (const e of events) {
      const business = keyToBusiness.get(e.idempotency_key);
      const inst = byId.get(e.instance_id);
      if (business && inst && !out.has(business)) out.set(business, inst);
    }
    return out;
  }
}
