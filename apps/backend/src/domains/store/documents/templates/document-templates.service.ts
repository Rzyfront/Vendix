import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { StoredFilesService } from '../stored-files.service';
import { BasePdfPagesService } from './base-pdf-pages.service';
import {
  BasePdfBody,
  BlocksBody,
  TemplateBodyError,
  bodyHash,
  bodyTexts,
  tableSourcesOf,
  tokenSchemaOfBasePdf,
  tokenSchemaOfBlocks,
  validateBasePdfBody,
  validateBlocksBody,
} from './template-body';
import { DataTree, TemplateDataService, sampleValues } from './template-data.service';
import { TemplateRenderService } from './template-render.service';
import { TokenSchemaEntry } from './template-tokens';
import { CreateTemplateDto, TemplatesQueryDto, UpdateTemplateDto } from './dto/template.dto';

type Kind = 'blocks' | 'base_pdf';

type TemplateRow = Prisma.document_templatesGetPayload<{
  include: { published_version: { select: { id: true; version: true; published_at: true } } };
}>;

const EMPTY_BODY: Record<Kind, (name: string) => Record<string, unknown>> = {
  blocks: (name) => ({
    page: { size: 'A4' },
    footer: { page_numbers: true },
    blocks: [{ type: 'heading', text: name, level: 1 }],
    signature_slots: [],
  }),
  base_pdf: () => ({ fields: [], signature_slots: [] }),
};

/** Templates of the store: draft, immutable published versions, preview (P4.1/P4.5). */
@Injectable()
export class DocumentTemplatesService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly files: StoredFilesService,
    private readonly basePages: BasePdfPagesService,
    private readonly data: TemplateDataService,
    private readonly renderer: TemplateRenderService,
  ) {}

  private ctx() {
    const c = RequestContextService.getContext();
    if (!c?.store_id || !c.organization_id) throw new VendixHttpException(ErrorCodes.DOCTPL_NOT_FOUND);
    return { store_id: c.store_id, organization_id: c.organization_id, user_id: c.user_id ?? 0 };
  }

  private async find(id: number) {
    const row = await this.prisma.document_templates.findFirst({
      where: { id, store_id: this.ctx().store_id },
      include: { published_version: { select: { id: true, version: true, published_at: true } } },
    });
    if (!row) throw new VendixHttpException(ErrorCodes.DOCTPL_NOT_FOUND);
    return row;
  }

  /** `update` by id only is not store-scoped: patch by (id, store) and read back. */
  private async patch(id: number, data: Record<string, unknown>) {
    await this.prisma.document_templates.updateMany({ where: { id, store_id: this.ctx().store_id }, data: data as never });
    return this.find(id);
  }

  private shape(row: TemplateRow) {
    return {
      id: row.id,
      key: row.key,
      name: row.name,
      category: row.category,
      kind: row.kind,
      status: row.status,
      base_file_id: row.base_file_id,
      published_version: row.published_version
        ? { id: row.published_version.id, version: row.published_version.version, published_at: row.published_version.published_at }
        : null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  async list(q: TemplatesQueryDto) {
    const rows = await this.prisma.document_templates.findMany({
      where: {
        store_id: this.ctx().store_id,
        ...(q.status ? { status: q.status } : {}),
        ...(q.kind ? { kind: q.kind } : {}),
        ...(q.search?.trim()
          ? {
              OR: [
                { name: { contains: q.search.trim(), mode: 'insensitive' as const } },
                { key: { contains: q.search.trim(), mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      include: { published_version: { select: { id: true, version: true, published_at: true } } },
      orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
      take: 200,
    });
    return rows.map((r) => this.shape(r));
  }

  async get(id: number) {
    const row = await this.find(id);
    return { ...this.shape(row), body: row.draft_body };
  }

  async create(dto: CreateTemplateDto) {
    const c = this.ctx();
    try {
      const row = await this.prisma.document_templates.create({
        data: {
          organization_id: c.organization_id,
          store_id: c.store_id,
          key: dto.key,
          name: dto.name.trim(),
          category: dto.category?.trim() || 'other',
          kind: dto.kind,
          draft_body: EMPTY_BODY[dto.kind](dto.name.trim()) as never,
          created_by_user_id: c.user_id,
        },
        include: { published_version: { select: { id: true, version: true, published_at: true } } },
      });
      return { ...this.shape(row), body: row.draft_body };
    } catch (e) {
      if ((e as { code?: string })?.code === 'P2002') throw new VendixHttpException(ErrorCodes.DOCTPL_KEY_TAKEN);
      throw e;
    }
  }

  private validate(kind: Kind, body: unknown, pageCount?: number): BlocksBody | BasePdfBody {
    try {
      return kind === 'blocks' ? validateBlocksBody(body) : validateBasePdfBody(body, pageCount);
    } catch (e) {
      if (e instanceof TemplateBodyError) {
        throw new VendixHttpException(ErrorCodes.DOCTPL_INVALID, e.errors[0], { errors: e.errors });
      }
      throw e;
    }
  }

  /** Edits the draft. A published template keeps serving its published version until it is published again. */
  async updateDraft(id: number, dto: UpdateTemplateDto) {
    const row = await this.find(id);
    if (row.status === 'archived') throw new VendixHttpException(ErrorCodes.DOCTPL_ARCHIVED);
    if (dto.body !== undefined) this.validate(row.kind, dto.body);
    const updated = await this.patch(id, {
      ...(dto.name ? { name: dto.name.trim() } : {}),
      ...(dto.category ? { category: dto.category.trim() } : {}),
      ...(dto.body !== undefined ? { draft_body: dto.body } : {}),
    });
    return { ...this.shape(updated), body: updated.draft_body };
  }

  /** P4.5: stores the base PDF (type, size and hash checked by the files service) and returns its pages. */
  async uploadBasePdf(id: number, file: Express.Multer.File | undefined) {
    const row = await this.find(id);
    if (row.kind !== 'base_pdf') {
      throw new VendixHttpException(ErrorCodes.DOCTPL_INVALID, 'Solo las plantillas "desde un PDF base" llevan un PDF base.');
    }
    if (row.status === 'archived') throw new VendixHttpException(ErrorCodes.DOCTPL_ARCHIVED);
    if (!file?.buffer?.length) throw new VendixHttpException(ErrorCodes.DOCUMENT_FILE_REQUIRED);
    const pages = await this.basePages.rasterize(file.buffer);
    const stored = await this.files.upload({
      buffer: file.buffer,
      mimeType: 'application/pdf',
      originalName: file.originalname || 'base.pdf',
      accept: ['application/pdf'],
      folder: 'documents/templates',
      source: 'upload',
    });
    const updated = await this.patch(id, { base_file_id: stored.id });
    return { ...this.shape(updated), body: updated.draft_body, page_count: pages.length };
  }

  /** Page images and sizes (PDF points) of the draft's base PDF, for the field editor. */
  async basePagesOf(id: number) {
    const row = await this.find(id);
    if (row.kind !== 'base_pdf' || !row.base_file_id) throw new VendixHttpException(ErrorCodes.DOCTPL_BASE_PDF_REQUIRED);
    const pages = await this.basePages.rasterize(await this.renderer.fileBytes(row.base_file_id));
    return pages.map((p) => ({ page: p.page, width_pt: p.width_pt, height_pt: p.height_pt, image: p.data_uri }));
  }

  /** Real render of the draft with example data and the "VISTA PREVIA" watermark. */
  async preview(id: number): Promise<Buffer> {
    const row = await this.find(id);
    const body = this.validate(row.kind, row.draft_body);
    if (row.kind === 'base_pdf' && !row.base_file_id) throw new VendixHttpException(ErrorCodes.DOCTPL_BASE_PDF_REQUIRED);
    const schema = this.schemaOf(row.kind, body);
    const store = await this.data.store();
    const c = this.ctx();
    const now = new Date().toISOString();
    const tree: DataTree = {
      store: store.tree,
      user: await this.data.user(c.user_id || null),
      instance: { id: 0, reference: 'SOL-000123', title: 'Solicitud de ejemplo', created_at: now, current_stage: 'Etapa de ejemplo' },
      fields: {},
      subject: { type: 'employee', id: 1 },
      now,
    };
    const real = this.data.scopeFor(schema, tree, store);
    const texts = bodyTexts(row.kind, body);
    const values = {
      ...sampleValues(texts, row.kind === 'blocks' ? tableSourcesOf(body as BlocksBody) : []),
      ...real.values,
    };
    return this.renderer.render({
      kind: row.kind,
      body,
      base_file_id: row.base_file_id,
      scope: { ...real, values },
      title: row.name,
      preview: true,
    });
  }

  private schemaOf(kind: Kind, body: BlocksBody | BasePdfBody): TokenSchemaEntry[] {
    return kind === 'blocks' ? tokenSchemaOfBlocks(body as BlocksBody) : tokenSchemaOfBasePdf(body as BasePdfBody);
  }

  /**
   * Publishes the draft as the next immutable version. Publishing a draft that
   * equals the published version (same body hash and base PDF) creates nothing.
   */
  async publish(id: number) {
    const row = await this.find(id);
    if (row.status === 'archived') throw new VendixHttpException(ErrorCodes.DOCTPL_ARCHIVED);
    let baseSha: string | null = null;
    let pageCount: number | undefined;
    if (row.kind === 'base_pdf') {
      if (!row.base_file_id) throw new VendixHttpException(ErrorCodes.DOCTPL_BASE_PDF_REQUIRED);
      const base = await this.prisma.stored_files.findFirst({
        where: { id: row.base_file_id, store_id: row.store_id, deleted_at: null },
        select: { sha256: true },
      });
      if (!base) throw new VendixHttpException(ErrorCodes.DOCTPL_BASE_PDF_REQUIRED);
      baseSha = base.sha256;
      pageCount = (await this.basePages.rasterize(await this.renderer.fileBytes(row.base_file_id))).length;
    }
    const body = this.validate(row.kind, row.draft_body, pageCount);
    const hash = bodyHash(row.kind, body, baseSha);
    const c = this.ctx();

    return this.prisma.$transaction(async (tx: any) => {
      // The template row is the lock: two publishers of one template queue up.
      await tx.document_templates.updateMany({ where: { id, store_id: c.store_id }, data: { updated_at: new Date() } });
      // Read again under the lock: a publish that ran meanwhile already moved it.
      const locked = await tx.document_templates.findFirst({
        where: { id, store_id: c.store_id },
        select: { published_version_id: true },
      });
      const publishedId: number | null = locked?.published_version_id ?? null;
      const current = publishedId
        ? await tx.document_template_versions.findFirst({
            where: { id: publishedId, store_id: c.store_id },
            select: { id: true, version: true, body_hash: true, published_at: true },
          })
        : null;
      if (current && current.body_hash === hash) {
        return { created: false, version: current.version, version_id: current.id, body_hash: hash };
      }
      const last = await tx.document_template_versions.findFirst({
        where: { template_id: id, store_id: c.store_id },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const version = await tx.document_template_versions.create({
        data: {
          store_id: c.store_id,
          template_id: id,
          version: (last?.version ?? 0) + 1,
          kind: row.kind,
          body: body as never,
          token_schema: this.schemaOf(row.kind, body) as never,
          body_hash: hash,
          base_file_id: row.kind === 'base_pdf' ? row.base_file_id : null,
          published_by_user_id: c.user_id,
        },
      });
      await tx.document_templates.updateMany({
        where: { id, store_id: c.store_id },
        data: { status: 'published', published_version_id: version.id },
      });
      return { created: true, version: version.version, version_id: version.id, body_hash: hash };
    });
  }

  async versions(id: number) {
    await this.find(id);
    const rows = await this.prisma.document_template_versions.findMany({
      where: { template_id: id, store_id: this.ctx().store_id },
      orderBy: { version: 'desc' },
      select: {
        id: true,
        version: true,
        kind: true,
        body_hash: true,
        token_schema: true,
        base_file_id: true,
        published_by_user_id: true,
        published_at: true,
      },
    });
    return rows;
  }

  async version(id: number, versionId: number) {
    await this.find(id);
    const row = await this.prisma.document_template_versions.findFirst({
      where: { id: versionId, template_id: id, store_id: this.ctx().store_id },
    });
    if (!row) throw new VendixHttpException(ErrorCodes.DOCTPL_NOT_FOUND);
    return row;
  }

  /** Archived templates cannot be issued; issued documents keep their frozen version. */
  async archive(id: number) {
    const row = await this.find(id);
    const updated = await this.patch(row.id, { status: 'archived' });
    return this.shape(updated);
  }
}
