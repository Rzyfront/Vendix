import { Injectable } from '@nestjs/common';
import { WorkflowDefinitionV1, findStage } from '@common/workflows/contract';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { DocumentActor, DossiersService } from '../dossiers.service';
import { IssuedDocumentsRenderQueue } from './issued-documents.queue';
import { IssuedSnapshot } from './issued-snapshot';
import { bodyTexts, sha256Json } from './template-body';
import type { BasePdfBody, BlocksBody } from './template-body';
import { DataTree, TemplateDataService } from './template-data.service';
import {
  MissingTokenError,
  TokenSchemaEntry,
  TokenSyntaxError,
  TokenValueError,
  isRowPath,
  missingPaths,
  renderText,
} from './template-tokens';

export interface EmitInput {
  instance_id: number;
  template_key?: string;
  template_id?: number;
  requirement_key?: string | null;
  title?: string | null;
  /** Stage the document belongs to; defaults to the current stage of the request. */
  stage_key?: string | null;
  actor: DocumentActor;
  /** Reissue of an older document: its requirement may belong to an earlier stage. */
  skipStageCheck?: boolean;
}

export interface IssuedDocumentView {
  id: number;
  reference: string;
  title: string;
  status: string;
  error: string | null;
  template: { id: number; key: string; name: string };
  template_version: number;
  requirement_key: string | null;
  stage_key: string | null;
  workflow_instance_id: number | null;
  dossier_id: number | null;
  file_id: number | null;
  pdf_sha256: string | null;
  supersedes_id: number | null;
  void_reason: string | null;
  issued_by_type: string;
  issued_by_id: number | null;
  issued_at: Date | null;
  created_at: Date;
}

const VOIDABLE = ['issued', 'signed', 'failed'];

/** Emission, reading and voiding of issued documents (P4.1). Rendering lives in the queue. */
@Injectable()
export class IssuedDocumentsService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly data: TemplateDataService,
    private readonly dossiers: DossiersService,
    private readonly queue: IssuedDocumentsRenderQueue,
  ) {}

  private ctx() {
    const c = RequestContextService.getContext();
    if (!c?.store_id || !c.organization_id) throw new VendixHttpException(ErrorCodes.DOCISSUE_NOT_FOUND);
    return { store_id: c.store_id, organization_id: c.organization_id, user_id: c.user_id ?? null };
  }

  /** `DOC-` + zero-padded per-store sequence; the store row is locked inside the caller's transaction. */
  private async nextReference(tx: any, storeId: number): Promise<string> {
    await tx.$queryRaw`SELECT id FROM stores WHERE id = ${storeId} FOR NO KEY UPDATE`;
    const rows: Array<{ n: number | bigint }> = await tx.$queryRaw`
      SELECT (COALESCE(MAX(CAST(SUBSTRING(reference FROM 5) AS INTEGER)), 0) + 1)::int AS n
      FROM issued_documents
      WHERE store_id = ${storeId} AND reference ~ '^DOC-[0-9]+$'`;
    return `DOC-${String(Number(rows[0]?.n ?? 1)).padStart(6, '0')}`;
  }

  /**
   * Freezes the data, creates the document in `rendering` and queues the
   * render. Strict: a required value that cannot be resolved stops the
   * emission with a readable error; there is never a PDF with gaps.
   */
  async emit(input: EmitInput): Promise<IssuedDocumentView> {
    const c = this.ctx();
    const found = await this.data.instance(input.instance_id);
    if (!found) throw new VendixHttpException(ErrorCodes.WORKFLOW_NOT_FOUND);
    const { row: instance, definition } = found;
    if (instance.status !== 'active') {
      throw new VendixHttpException(ErrorCodes.DOCISSUE_INSTANCE_CLOSED);
    }

    const requirement = input.requirement_key
      ? this.requirementOf(definition, instance.current_stage_key, input.requirement_key, input.skipStageCheck)
      : null;
    const templateKey = input.template_key ?? requirement?.template_key;
    if (!input.template_id && !templateKey) throw new VendixHttpException(ErrorCodes.DOCTPL_NOT_FOUND);
    if (requirement && input.template_key && requirement.template_key !== input.template_key) {
      throw new VendixHttpException(
        ErrorCodes.DOCUMENT_TARGET_INVALID,
        `El requisito "${input.requirement_key}" usa la plantilla "${requirement.template_key}".`,
      );
    }
    const template = await this.prisma.document_templates.findFirst({
      where: { store_id: c.store_id, ...(input.template_id ? { id: input.template_id } : { key: templateKey }) },
      include: { published_version: true },
    });
    if (!template) throw new VendixHttpException(ErrorCodes.DOCTPL_NOT_FOUND);
    if (template.status === 'archived') throw new VendixHttpException(ErrorCodes.DOCTPL_ARCHIVED);
    const version = template.published_version;
    if (!version) throw new VendixHttpException(ErrorCodes.DOCTPL_NOT_PUBLISHED);

    const store = await this.data.store();
    const userId = input.actor.type === 'user' ? input.actor.id : c.user_id;
    const tree: DataTree = {
      store: store.tree,
      user: await this.data.user(userId),
      now: new Date().toISOString(),
      ...this.data.instanceTree(found),
    };
    const schema = (version.token_schema ?? []) as unknown as TokenSchemaEntry[];
    const scope = this.data.scopeFor(schema, tree, store);
    const labels = this.data.labelsOf(definition);
    const label = (path: string) => labels[path] ?? path;

    const missing = missingPaths(schema, scope);
    if (missing.length > 0) {
      throw new VendixHttpException(
        ErrorCodes.DOCISSUE_DATA_MISSING,
        `Falta el dato '${label(missing[0])}' para emitir '${template.name}'`,
        { missing: missing.map((path) => ({ path, label: label(path) })) },
      );
    }
    this.assertFormattable(version.kind, version.body, scope, label, template.name);

    const snapshot: IssuedSnapshot = { timezone: store.timezone, currency: store.currency, values: scope.values };
    const chain = input.requirement_key
      ? { requirement_key: input.requirement_key }
      : { requirement_key: null, template_id: template.id };

    const created = await this.prisma.$transaction(async (tx: any) => {
      const previous = await tx.issued_documents.findFirst({
        where: {
          store_id: c.store_id,
          workflow_instance_id: instance.id,
          ...chain,
          status: { notIn: ['superseded', 'voided'] },
        },
        orderBy: { id: 'desc' },
        select: { id: true, status: true },
      });
      if (previous?.status === 'rendering') {
        throw new VendixHttpException(ErrorCodes.DOCISSUE_STATE, 'El documento anterior todavía se está generando.');
      }
      if (previous?.status === 'pending_signature') {
        throw new VendixHttpException(
          ErrorCodes.DOCISSUE_STATE,
          'El documento anterior tiene una firma en curso; cancela la firma antes de emitirlo de nuevo.',
        );
      }
      const dossier = await this.dossiers.getByInstance(instance.id, tx);
      return tx.issued_documents.create({
        data: {
          organization_id: c.organization_id,
          store_id: c.store_id,
          reference: await this.nextReference(tx, c.store_id),
          title: (input.title?.trim() || template.name).slice(0, 200),
          template_id: template.id,
          template_version_id: version.id,
          dossier_id: dossier?.id ?? null,
          workflow_instance_id: instance.id,
          requirement_key: input.requirement_key ?? null,
          stage_key: input.stage_key ?? instance.current_stage_key,
          data_snapshot: snapshot as never,
          data_hash: sha256Json(snapshot),
          status: 'rendering',
          supersedes_id: previous?.id ?? null,
          issued_by_type: input.actor.type,
          issued_by_id: input.actor.id,
        },
      });
    });
    this.queue.kick({ id: created.id, store_id: c.store_id, organization_id: c.organization_id });
    return this.view({ ...created, template, template_version: version });
  }

  /** Requirement of the request's stage; `skipStageCheck` looks it up in any stage. */
  private requirementOf(
    definition: WorkflowDefinitionV1,
    stageKey: string,
    key: string,
    anyStage = false,
  ): { template_key: string } {
    const stages = anyStage ? definition.stages : [findStage(definition, stageKey)].filter(Boolean);
    for (const stage of stages) {
      const req = stage?.requirements?.find((r) => r.kind === 'issued_document' && r.key === key);
      if (req && req.kind === 'issued_document') return { template_key: req.template_key };
    }
    throw new VendixHttpException(
      ErrorCodes.DOCUMENT_TARGET_INVALID,
      `El requisito "${key}" no es un documento emitido de la etapa actual de la solicitud.`,
    );
  }

  /** Filters that cannot format their value (text in a `money`, a bad date) stop the emission too. */
  private assertFormattable(
    kind: 'blocks' | 'base_pdf',
    body: unknown,
    scope: ReturnType<TemplateDataService['scopeFor']>,
    label: (path: string) => string,
    templateName: string,
  ): void {
    for (const text of bodyTexts(kind, body as BlocksBody | BasePdfBody)) {
      try {
        renderText(text, scope);
      } catch (e) {
        if (e instanceof MissingTokenError && isRowPath(e.path)) continue;
        if (e instanceof MissingTokenError) {
          throw new VendixHttpException(
            ErrorCodes.DOCISSUE_DATA_MISSING,
            `Falta el dato '${label(e.path)}' para emitir '${templateName}'`,
          );
        }
        if (e instanceof TokenValueError) {
          throw new VendixHttpException(
            ErrorCodes.DOCISSUE_DATA_MISSING,
            `El dato '${label(e.path)}' no es válido para emitir '${templateName}': ${e.detail}`,
          );
        }
        if (e instanceof TokenSyntaxError) {
          throw new VendixHttpException(ErrorCodes.DOCTPL_INVALID, e.message);
        }
        throw e;
      }
    }
  }

  /** Reissues a document with the data of the request as it is now. */
  async reissue(id: number, actor: DocumentActor): Promise<IssuedDocumentView> {
    const doc = await this.find(id);
    if (!doc.workflow_instance_id) throw new VendixHttpException(ErrorCodes.DOCISSUE_STATE);
    return this.emit({
      instance_id: doc.workflow_instance_id,
      template_id: doc.template_id,
      requirement_key: doc.requirement_key,
      title: doc.title,
      stage_key: doc.stage_key,
      skipStageCheck: true,
      actor,
    });
  }

  private async find(id: number) {
    const doc = await this.prisma.issued_documents.findFirst({
      where: { id, store_id: this.ctx().store_id },
      include: { template: { select: { id: true, key: true, name: true } }, template_version: { select: { version: true } } },
    });
    if (!doc) throw new VendixHttpException(ErrorCodes.DOCISSUE_NOT_FOUND);
    return doc;
  }

  async get(id: number): Promise<IssuedDocumentView> {
    return this.view(await this.find(id));
  }

  async list(filter: { instance_id?: number; dossier_id?: number; status?: string }): Promise<IssuedDocumentView[]> {
    const rows = await this.prisma.issued_documents.findMany({
      where: {
        store_id: this.ctx().store_id,
        ...(filter.instance_id ? { workflow_instance_id: filter.instance_id } : {}),
        ...(filter.dossier_id ? { dossier_id: filter.dossier_id } : {}),
        ...(filter.status ? { status: filter.status as never } : {}),
      },
      include: { template: { select: { id: true, key: true, name: true } }, template_version: { select: { version: true } } },
      orderBy: { id: 'desc' },
      take: 200,
    });
    return rows.map((r) => this.view(r));
  }

  /** Voids an issued, signed or failed document with a reason; its requirement becomes pending again. */
  async voidDocument(id: number, reason: string, actor: DocumentActor): Promise<IssuedDocumentView> {
    const c = this.ctx();
    const doc = await this.find(id);
    if (!VOIDABLE.includes(doc.status)) {
      throw new VendixHttpException(
        ErrorCodes.DOCISSUE_STATE,
        doc.status === 'pending_signature'
          ? 'El documento tiene una firma en curso; cancela la firma antes de anularlo.'
          : undefined,
      );
    }
    const clean = reason.trim().slice(0, 500);
    await this.prisma.$transaction(async (tx: any) => {
      const done = await tx.issued_documents.updateMany({
        where: { id, store_id: c.store_id, status: { in: VOIDABLE } },
        data: { status: 'voided', void_reason: clean },
      });
      if (done.count === 0) throw new VendixHttpException(ErrorCodes.DOCISSUE_STATE);
      await tx.dossier_items.updateMany({
        where: { issued_document_id: id, store_id: c.store_id },
        data: { status: 'rejected', note: `Anulado: ${clean}` },
      });
      if (doc.workflow_instance_id) {
        await this.queue.appendEvent(tx, c.store_id, doc.workflow_instance_id, 'document_voided', {
          issued_document_id: id,
          reference: doc.reference,
          requirement_key: doc.requirement_key,
          reason: clean,
          actor_id: actor.id,
        });
      }
    });
    return this.get(id);
  }

  private view(row: {
    id: number;
    reference: string;
    title: string;
    status: string;
    error: string | null;
    template: { id: number; key: string; name: string };
    template_version: { version: number };
    requirement_key: string | null;
    stage_key: string | null;
    workflow_instance_id: number | null;
    dossier_id: number | null;
    file_id: number | null;
    pdf_sha256: string | null;
    supersedes_id: number | null;
    void_reason: string | null;
    issued_by_type: string;
    issued_by_id: number | null;
    issued_at: Date | null;
    created_at: Date;
  }): IssuedDocumentView {
    return {
      id: row.id,
      reference: row.reference,
      title: row.title,
      status: row.status,
      error: row.error,
      template: { id: row.template.id, key: row.template.key, name: row.template.name },
      template_version: row.template_version.version,
      requirement_key: row.requirement_key,
      stage_key: row.stage_key,
      workflow_instance_id: row.workflow_instance_id,
      dossier_id: row.dossier_id,
      file_id: row.file_id,
      pdf_sha256: row.pdf_sha256,
      supersedes_id: row.supersedes_id,
      void_reason: row.void_reason,
      issued_by_type: row.issued_by_type,
      issued_by_id: row.issued_by_id,
      issued_at: row.issued_at,
      created_at: row.created_at,
    };
  }
}
