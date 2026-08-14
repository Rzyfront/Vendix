import { Injectable, Logger } from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '@common/errors';
import {
  SetMembershipNoteDto,
  BulkSetMembershipNotesDto,
} from './dto/membership-note.dto';

/**
 * MembershipNotesService
 *
 * Store-scoped CRUD/upsert for `membership_member_notes`. Mirror of the
 * `consultations.service` flow over `customer_consultation_notes` but
 * without the `booking_id` FK — a member note is independent of any
 * specific consultation.
 *
 * Use cases:
 *  - Bulk-scan OCR importer (QUI-558): persist EPS, estado_fisico, lesiones
 *    as one row per `note_key` per `customer_id`.
 *  - Ficha del socio: surface med-info and emergency-contact details live
 *    (notes with `include_in_summary=true` mirror the consultas flow).
 *  - Re-import idempotency: `upsertOne` / `bulkSet` are NOOP-safe when the
 *    same value is written twice.
 *
 * Scope: `membership_member_notes` is a `store_scoped_model` but the
 * scoped extension does not provide the unique-operation guarantee we need
 * for the bulk importer. We use `withoutScope()` + explicit `store_id`
 * predicates (same pattern as MembershipsService / MemberProfilesService).
 */
@Injectable()
export class MembershipNotesService {
  private readonly logger = new Logger(MembershipNotesService.name);

  constructor(private readonly prisma: StorePrismaService) {}

  private requireStoreId(): number {
    const storeId = RequestContextService.getContext()?.store_id;
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    return storeId;
  }

  private get notes() {
    return this.prisma.withoutScope().membership_member_notes;
  }

  /**
   * List all notes for a customer in the current store. Optionally filters
   * to notes flagged `include_in_summary=true` (the "surface in ficha"
   * pattern). Returns [] when the customer has no notes — does NOT 404.
   */
  async findByCustomer(
    customerId: number,
    opts?: { importantOnly?: boolean },
  ) {
    const storeId = this.requireStoreId();
    return this.notes.findMany({
      where: {
        store_id: storeId,
        customer_id: customerId,
        ...(opts?.importantOnly ? { include_in_summary: true } : {}),
      },
      orderBy: [{ note_key: 'asc' }, { created_at: 'asc' }],
    });
  }

  /**
   * Null when the key doesn't exist. Callers (the bulk-scan importer) use
   * this to decide CREATE-vs-UPDATE without a separate existence check.
   */
  async findOneByKey(customerId: number, noteKey: string) {
    const storeId = this.requireStoreId();
    return this.notes.findFirst({
      where: {
        store_id: storeId,
        customer_id: customerId,
        note_key: noteKey,
      },
    });
  }

  /**
   * Upsert a single (customer_id, note_key) row. Idempotent — re-calling
   * with the same `note_value` and `include_in_summary` is a no-op.
   *
   * Returns `{ row, created }` so callers can log skip-vs-insert.
   */
  async upsertOne(
    customerId: number,
    dto: SetMembershipNoteDto,
  ): Promise<{ row: any; created: boolean }> {
    const storeId = this.requireStoreId();

    // Ensure the customer exists in the org (cheap pre-check; the FK will
    // also enforce this on insert).
    const customer = await this.prisma.users.findFirst({
      where: { id: customerId },
      select: { id: true },
    });
    if (!customer) {
      throw new VendixHttpException(
        ErrorCodes.SYS_NOT_FOUND_001,
        'El cliente (socio) no existe',
      );
    }

    const existing = await this.notes.findFirst({
      where: {
        store_id: storeId,
        customer_id: customerId,
        note_key: dto.note_key,
      },
      select: { id: true, include_in_summary: true },
    });

    if (existing) {
      const updated = await this.notes.update({
        where: { id: existing.id },
        data: {
          note_value: dto.note_value,
          // Caller omission ⇒ keep existing flag (parity with consultations.service).
          include_in_summary:
            dto.include_in_summary ?? existing.include_in_summary,
          updated_at: new Date(),
        },
      });
      return { row: updated, created: false };
    }

    const created = await this.notes.create({
      data: {
        store_id: storeId,
        customer_id: customerId,
        note_key: dto.note_key,
        note_value: dto.note_value,
        include_in_summary: dto.include_in_summary ?? false,
      },
    });
    return { row: created, created: true };
  }

  /**
   * Bulk-set notes for a single customer. Used by the bulk-scan commit
   * (QUI-558) and by the ficha del socio "save all notes" action.
   *
   * Wraps the upserts in a transaction so a half-saved set is impossible.
   * Duplicate `note_key`s in the input list are de-duplicated (last-write
   * wins) before the upsert loop.
   */
  async bulkSet(
    customerId: number,
    dto: BulkSetMembershipNotesDto,
  ): Promise<{ upserted: number; created: number; updated: number }> {
    const storeId = this.requireStoreId();

    // De-duplicate by note_key (last occurrence wins).
    const dedupMap = new Map<string, SetMembershipNoteDto>();
    for (const n of dto.notes ?? []) {
      dedupMap.set(n.note_key, n);
    }
    const unique = Array.from(dedupMap.values());
    if (unique.length === 0) {
      return { upserted: 0, created: 0, updated: 0 };
    }

    // Pre-check the customer exists (cheaper than a partial FK failure).
    const customer = await this.prisma.users.findFirst({
      where: { id: customerId },
      select: { id: true },
    });
    if (!customer) {
      throw new VendixHttpException(
        ErrorCodes.SYS_NOT_FOUND_001,
        'El cliente (socio) no existe',
      );
    }

    let created = 0;
    let updated = 0;

    await this.prisma.$transaction(async (tx) => {
      const txNotes = tx.membership_member_notes;
      for (const n of unique) {
        const existing = await txNotes.findFirst({
          where: {
            store_id: storeId,
            customer_id: customerId,
            note_key: n.note_key,
          },
          select: { id: true, include_in_summary: true },
        });
        if (existing) {
          await txNotes.update({
            where: { id: existing.id },
            data: {
              note_value: n.note_value,
              include_in_summary:
                n.include_in_summary ?? existing.include_in_summary,
              updated_at: new Date(),
            },
          });
          updated++;
        } else {
          await txNotes.create({
            data: {
              store_id: storeId,
              customer_id: customerId,
              note_key: n.note_key,
              note_value: n.note_value,
              include_in_summary: n.include_in_summary ?? false,
            },
          });
          created++;
        }
      }
    });

    return { upserted: unique.length, created, updated };
  }

  /**
   * Delete a single note. Returns true when a row was removed, false when
   * no matching row existed.
   */
  async deleteByKey(customerId: number, noteKey: string): Promise<boolean> {
    const storeId = this.requireStoreId();
    const existing = await this.notes.findFirst({
      where: {
        store_id: storeId,
        customer_id: customerId,
        note_key: noteKey,
      },
      select: { id: true },
    });
    if (!existing) return false;
    await this.notes.delete({ where: { id: existing.id } });
    return true;
  }

  /**
   * Cross-customer "important notes" lookup. Mirrors the consultations
   * importantNote query — surfaces a customer's other notes (EPS, lesiones)
   * to the ficha del socio so the user does not need to fetch them per-key.
   */
  async findImportantNotes(limit = 20) {
    const storeId = this.requireStoreId();
    return this.notes.findMany({
      where: { store_id: storeId, include_in_summary: true },
      orderBy: { created_at: 'desc' },
      take: limit,
    });
  }
}
