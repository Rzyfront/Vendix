import { Injectable } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { AuditAction, AuditService } from '@common/audit/audit.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { UpdateFileProfileDto } from './document-file-profiles.dto';

export const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 40;

/** Lower-cases, trims and de-duplicates tags; more than {@link MAX_TAGS} is invalid. */
export function normalizeTags(raw: string[]): string[] {
  const seen = new Set<string>();
  for (const t of raw) {
    const tag = String(t ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
    if (!tag) continue;
    if (tag.length > MAX_TAG_LENGTH) {
      throw new VendixHttpException(
        ErrorCodes.DOCPROFILE_INVALID,
        `Cada etiqueta admite hasta ${MAX_TAG_LENGTH} caracteres.`,
      );
    }
    seen.add(tag);
  }
  if (seen.size > MAX_TAGS) {
    throw new VendixHttpException(
      ErrorCodes.DOCPROFILE_INVALID,
      `Un documento admite hasta ${MAX_TAGS} etiquetas.`,
    );
  }
  return [...seen];
}

/** `YYYY-MM-DD` → UTC midnight (what a `@db.Date` column stores); rejects impossible dates. */
export function parseDateOnly(value: string): Date {
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
    throw new VendixHttpException(
      ErrorCodes.DOCPROFILE_INVALID,
      'La fecha de vencimiento no es válida.',
    );
  }
  return d;
}

export interface FileProfileView {
  file_id: number;
  doc_type: string | null;
  tags: string[];
  valid_until: string | null;
  legal_hold: boolean;
}

/** Editable metadata of a stored file (type, tags, expiry) and its legal hold. */
@Injectable()
export class DocumentFileProfilesService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly audit: AuditService,
  ) {}

  private ctx() {
    const c = RequestContextService.getContext();
    if (!c?.store_id || !c.organization_id) {
      throw new VendixHttpException(ErrorCodes.DOCUMENT_NOT_FOUND);
    }
    return { store_id: c.store_id, user_id: c.user_id ?? null, organization_id: c.organization_id };
  }

  private async liveFile(fileId: number, storeId: number) {
    const file = await this.prisma.stored_files.findFirst({
      where: { id: fileId, store_id: storeId, deleted_at: null },
      select: { id: true, legal_hold: true, purged_at: true },
    });
    if (!file) throw new VendixHttpException(ErrorCodes.DOCUMENT_NOT_FOUND);
    if (file.purged_at) throw new VendixHttpException(ErrorCodes.DOCUMENT_PURGED);
    return file as { id: number; legal_hold: boolean; purged_at: Date | null };
  }

  private view(
    fileId: number,
    legalHold: boolean,
    p: { doc_type: string | null; tags: string[]; valid_until: Date | null } | null,
  ): FileProfileView {
    return {
      file_id: fileId,
      doc_type: p?.doc_type ?? null,
      tags: p?.tags ?? [],
      valid_until: p?.valid_until ? p.valid_until.toISOString().slice(0, 10) : null,
      legal_hold: legalHold,
    };
  }

  async get(fileId: number): Promise<FileProfileView> {
    const c = this.ctx();
    const file = await this.liveFile(fileId, c.store_id);
    const p = await this.prisma.document_file_profiles.findFirst({
      where: { file_id: fileId, store_id: c.store_id },
    });
    return this.view(fileId, file.legal_hold, p);
  }

  /**
   * Upserts the profile by `file_id`. Only the keys sent change. A new
   * `valid_until` clears `expiry_alerted_for`, so the new date alerts again.
   */
  async update(fileId: number, dto: UpdateFileProfileDto): Promise<FileProfileView> {
    const c = this.ctx();
    const file = await this.liveFile(fileId, c.store_id);
    const data: Record<string, unknown> = { updated_by_user_id: c.user_id };
    if (dto.doc_type !== undefined) {
      const t = dto.doc_type === null ? '' : dto.doc_type.trim();
      data['doc_type'] = t === '' ? null : t;
    }
    if (dto.tags !== undefined) data['tags'] = normalizeTags(dto.tags);
    const existing = await this.prisma.document_file_profiles.findFirst({
      where: { file_id: fileId, store_id: c.store_id },
    });
    if (dto.valid_until !== undefined) {
      const next = dto.valid_until === null ? null : parseDateOnly(dto.valid_until);
      const same =
        (existing?.valid_until ?? null) === null
          ? next === null
          : next !== null && existing!.valid_until!.getTime() === next.getTime();
      if (!same) {
        data['valid_until'] = next;
        data['expiry_alerted_for'] = null;
        data['expiry_alerted_at'] = null;
      }
    }
    if (existing) {
      await this.prisma.document_file_profiles.updateMany({
        where: { id: existing.id, store_id: c.store_id },
        data,
      });
    } else {
      await this.prisma.document_file_profiles.create({
        data: { ...data, store_id: c.store_id, file_id: fileId },
      });
    }
    await this.audit.log({
      userId: c.user_id ?? undefined,
      storeId: c.store_id,
      organizationId: c.organization_id,
      action: AuditAction.UPDATE,
      resource: 'stored_files',
      resourceId: fileId,
      metadata: { event: 'file_profile_updated', fields: Object.keys(data).filter((k) => k !== 'updated_by_user_id') },
    });
    return this.get(fileId).catch(() => this.view(fileId, file.legal_hold, null));
  }

  /** Marks or clears "Retención legal"; audited. */
  async setLegalHold(fileId: number, hold: boolean): Promise<FileProfileView> {
    const c = this.ctx();
    await this.liveFile(fileId, c.store_id);
    await this.prisma.stored_files.updateMany({
      where: { id: fileId, store_id: c.store_id },
      data: { legal_hold: hold },
    });
    await this.audit.log({
      userId: c.user_id ?? undefined,
      storeId: c.store_id,
      organizationId: c.organization_id,
      action: AuditAction.UPDATE,
      resource: 'stored_files',
      resourceId: fileId,
      metadata: { event: hold ? 'legal_hold_set' : 'legal_hold_cleared' },
    });
    return this.get(fileId);
  }
}
