import { Injectable } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { loadFileDossiers } from './file-dossier-context';
import {
  CUSTOM_RECORD,
  resolveSubjectLabels,
  subjectKey,
  SubjectLabel,
} from './subject-labels';

export interface SearchInput {
  q?: string;
  doc_type?: string;
  tag?: string;
  subject_type?: string;
  subject_id?: number;
  page?: number;
  limit?: number;
}

const normalizeTag = (t: string) => t.trim().replace(/\s+/g, ' ').toLowerCase();

/** Search over the live files of the dossiers, and the folders by entity (P4.7). */
@Injectable()
export class DocumentSearchService {
  constructor(private readonly prisma: StorePrismaService) {}

  private ctx() {
    const c = RequestContextService.getContext();
    if (!c?.store_id || !c.organization_id) {
      throw new VendixHttpException(ErrorCodes.DOCUMENT_NOT_FOUND);
    }
    return { store_id: c.store_id, organization_id: c.organization_id };
  }

  /**
   * Live files (neither deleted nor purged) that sit in a dossier of the
   * store, by name, type, tag and extracted text (`ILIKE`), filtered by type,
   * tag and subject. `store:documents:read` sees the whole store.
   */
  async search(input: SearchInput) {
    const c = this.ctx();
    const page = Math.max(1, input.page ?? 1);
    const limit = Math.min(100, Math.max(1, input.limit ?? 20));
    const and: Array<Record<string, unknown>> = [
      { store_id: c.store_id, deleted_at: null, purged_at: null },
    ];
    const dossier: Record<string, unknown> = { store_id: c.store_id };
    if (input.subject_type) dossier['subject_type'] = input.subject_type;
    if (input.subject_id) dossier['subject_id'] = input.subject_id;
    and.push({ items: { some: { store_id: c.store_id, dossier } } });

    const q = input.q?.trim();
    if (q) {
      const like = { contains: q, mode: 'insensitive' };
      and.push({
        OR: [
          { original_name: like },
          { profile: { doc_type: like } },
          { profile: { extracted_text: like } },
          { profile: { tags: { has: normalizeTag(q) } } },
        ],
      });
    }
    const docType = input.doc_type?.trim();
    if (docType) and.push({ profile: { doc_type: { equals: docType, mode: 'insensitive' } } });
    const tag = input.tag ? normalizeTag(input.tag) : '';
    if (tag) and.push({ profile: { tags: { has: tag } } });

    const where = { AND: and };
    const [files, total] = await Promise.all([
      this.prisma.stored_files.findMany({
        where,
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.stored_files.count({ where }),
    ]);
    return { data: await this.shape(c, files), total, page, limit };
  }

  private async shape(
    c: { store_id: number; organization_id: number },
    files: Array<{
      id: number;
      original_name: string;
      mime_type: string;
      size_bytes: number;
      created_at: Date;
      legal_hold: boolean;
    }>,
  ) {
    const ids = files.map((f) => f.id);
    const profiles: Array<{
      file_id: number;
      doc_type: string | null;
      tags: string[];
      valid_until: Date | null;
    }> = ids.length
      ? await this.prisma.document_file_profiles.findMany({
          where: { store_id: c.store_id, file_id: { in: ids } },
        })
      : [];
    const profileOf = new Map(profiles.map((p) => [p.file_id, p]));
    const context = await loadFileDossiers(this.prisma, c.store_id, ids);
    const labels = await resolveSubjectLabels(
      this.prisma,
      c,
      [...context.values()]
        .filter((d) => d.subject_type && d.subject_id)
        .map((d) => ({ type: d.subject_type as string, id: d.subject_id as number })),
    );
    return files.map((f) => {
      const p = profileOf.get(f.id);
      const d = context.get(f.id);
      const subject =
        d?.subject_type && d.subject_id
          ? this.subjectView(d.subject_type, d.subject_id, labels.get(subjectKey(d.subject_type, d.subject_id)), d.dossier_title)
          : null;
      return {
        id: f.id,
        original_name: f.original_name,
        mime_type: f.mime_type,
        size_bytes: f.size_bytes,
        created_at: f.created_at,
        legal_hold: f.legal_hold,
        doc_type: p?.doc_type ?? null,
        tags: p?.tags ?? [],
        valid_until: p?.valid_until ? p.valid_until.toISOString().slice(0, 10) : null,
        dossier: d ? { id: d.dossier_id, reference: d.dossier_reference, title: d.dossier_title } : null,
        subject,
        request: d?.workflow_instance_id
          ? { id: d.workflow_instance_id, reference: d.instance_reference, title: d.instance_title }
          : null,
      };
    });
  }

  private subjectView(type: string, id: number, found: SubjectLabel | undefined, fallback: string) {
    return {
      type,
      id,
      label: found?.label ?? fallback,
      collection_key: found?.collection_key ?? null,
      collection_name: found?.collection_name ?? null,
    };
  }

  // ----------------------------------------------------------------- folders

  /** Live dossier files per dossier of a store (`dossier_id` → count). */
  private async fileCounts(storeId: number): Promise<Map<number, number>> {
    const rows: Array<{ dossier_id: number; _count: { _all: number } }> =
      await this.prisma.dossier_items.groupBy({
        by: ['dossier_id'],
        where: {
          store_id: storeId,
          file_id: { not: null },
          file: { deleted_at: null, purged_at: null },
        },
        _count: { _all: true },
      });
    return new Map(rows.map((r) => [r.dossier_id, r._count._all]));
  }

  private async subjectDossiers(storeId: number, subjectType?: string) {
    const rows: Array<{
      id: number;
      title: string;
      subject_type: string;
      subject_id: number;
      created_at: Date;
    }> = await this.prisma.dossiers.findMany({
      where: {
        store_id: storeId,
        subject_type: subjectType ? subjectType : { not: null },
        subject_id: { not: null },
      },
      select: { id: true, title: true, subject_type: true, subject_id: true, created_at: true },
      orderBy: [{ id: 'asc' }],
    });
    return rows;
  }

  /**
   * Folders by kind of entity (customer, supplier, employee, ...). Records of
   * custom collections get one folder per collection, named after it.
   */
  async folders() {
    const c = this.ctx();
    const [dossiers, counts] = await Promise.all([
      this.subjectDossiers(c.store_id),
      this.fileCounts(c.store_id),
    ]);
    const labels = await resolveSubjectLabels(
      this.prisma,
      c,
      dossiers.filter((d) => d.subject_type === CUSTOM_RECORD).map((d) => ({ type: d.subject_type, id: d.subject_id })),
    );
    const groups = new Map<
      string,
      {
        subject_type: string;
        collection_key: string | null;
        collection_name: string | null;
        entities: Set<number>;
        dossiers: number;
        files: number;
      }
    >();
    for (const d of dossiers) {
      const col = d.subject_type === CUSTOM_RECORD ? labels.get(subjectKey(d.subject_type, d.subject_id)) : undefined;
      const key = `${d.subject_type}|${col?.collection_key ?? ''}`;
      let g = groups.get(key);
      if (!g) {
        g = {
          subject_type: d.subject_type,
          collection_key: col?.collection_key ?? null,
          collection_name: col?.collection_name ?? null,
          entities: new Set(),
          dossiers: 0,
          files: 0,
        };
        groups.set(key, g);
      }
      g.entities.add(d.subject_id);
      g.dossiers += 1;
      g.files += counts.get(d.id) ?? 0;
    }
    return [...groups.values()]
      .map(({ entities, ...g }) => ({ ...g, entities: entities.size }))
      .sort((a, b) => a.subject_type.localeCompare(b.subject_type) || (a.collection_name ?? '').localeCompare(b.collection_name ?? ''));
  }

  /** Entities of one kind with their counts, most recently active first. */
  async folderEntities(
    subjectType: string,
    input: { collection?: string; page?: number; limit?: number } = {},
  ) {
    const c = this.ctx();
    const page = Math.max(1, input.page ?? 1);
    const limit = Math.min(100, Math.max(1, input.limit ?? 20));
    const [dossiers, counts] = await Promise.all([
      this.subjectDossiers(c.store_id, subjectType),
      this.fileCounts(c.store_id),
    ]);
    let labels = new Map<string, SubjectLabel>();
    if (subjectType === CUSTOM_RECORD) {
      labels = await resolveSubjectLabels(
        this.prisma,
        c,
        dossiers.map((d) => ({ type: d.subject_type, id: d.subject_id })),
      );
    }
    const entities = new Map<
      number,
      { subject_id: number; dossiers: number; files: number; last_at: Date; title: string }
    >();
    for (const d of dossiers) {
      if (input.collection) {
        const col = labels.get(subjectKey(d.subject_type, d.subject_id));
        if (col?.collection_key !== input.collection) continue;
      }
      const e = entities.get(d.subject_id) ?? {
        subject_id: d.subject_id,
        dossiers: 0,
        files: 0,
        last_at: d.created_at,
        title: d.title,
      };
      e.dossiers += 1;
      e.files += counts.get(d.id) ?? 0;
      if (d.created_at >= e.last_at) {
        e.last_at = d.created_at;
        e.title = d.title;
      }
      entities.set(d.subject_id, e);
    }
    const sorted = [...entities.values()].sort(
      (a, b) => b.last_at.getTime() - a.last_at.getTime() || b.subject_id - a.subject_id,
    );
    const slice = sorted.slice((page - 1) * limit, page * limit);
    const pageLabels = await resolveSubjectLabels(
      this.prisma,
      c,
      slice.map((e) => ({ type: subjectType, id: e.subject_id })),
    );
    return {
      data: slice.map((e) => ({
        subject_type: subjectType,
        ...this.subjectView(subjectType, e.subject_id, pageLabels.get(subjectKey(subjectType, e.subject_id)), e.title),
        dossiers: e.dossiers,
        files: e.files,
      })),
      total: sorted.length,
      page,
      limit,
    };
  }

  /** Every live file of every dossier of one entity, with the dossiers it spans. */
  async folderFiles(subjectType: string, subjectId: number, input: { page?: number; limit?: number } = {}) {
    const c = this.ctx();
    const dossiers: Array<{
      id: number;
      reference: string;
      title: string;
      workflow_instance_id: number | null;
      closed_at: Date | null;
      created_at: Date;
    }> = await this.prisma.dossiers.findMany({
      where: { store_id: c.store_id, subject_type: subjectType, subject_id: subjectId },
      orderBy: [{ id: 'desc' }],
    });
    if (dossiers.length === 0) throw new VendixHttpException(ErrorCodes.DOCUMENT_NOT_FOUND);
    const labels = await resolveSubjectLabels(this.prisma, c, [{ type: subjectType, id: subjectId }]);
    const files = await this.search({
      subject_type: subjectType,
      subject_id: subjectId,
      page: input.page,
      limit: input.limit,
    });
    return {
      subject: this.subjectView(subjectType, subjectId, labels.get(subjectKey(subjectType, subjectId)), dossiers[0].title),
      dossiers: dossiers.map((d) => ({
        id: d.id,
        reference: d.reference,
        title: d.title,
        workflow_instance_id: d.workflow_instance_id,
        closed_at: d.closed_at,
        created_at: d.created_at,
      })),
      ...files,
    };
  }
}
