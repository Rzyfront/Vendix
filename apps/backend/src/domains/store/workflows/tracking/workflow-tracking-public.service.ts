import { Injectable } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { WorkflowDefinitionV1, WorkflowStageDef } from '@common/workflows/contract';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { DossiersService } from '../../documents/dossiers.service';
import { storeAllowsFlows } from '../engine/workflow-industry';
import { WorkflowEventsService } from '../engine/workflow-events.service';
import { WorkflowTx } from '../engine/workflow-engine.types';
import {
  UploadInit,
  UploadScope,
  WorkflowPublicUploadsService,
} from '../public-link/workflow-public-uploads.service';
import { hashTrackingToken } from './workflow-tracking-links.service';

export const TRACKING_MESSAGE_MAX_LENGTH = 2000;
const PUBLIC_ACTOR = { type: 'public' as const, id: null };

type UploadRequirement = Extract<
  NonNullable<WorkflowStageDef['requirements']>[number],
  { kind: 'upload' }
>;

export interface TrackingTimelineItem {
  type: 'started' | 'stage' | 'completed' | 'rejected' | 'cancelled' | 'external_upload' | 'external_message';
  label: string;
  detail: string | null;
  at: string;
}

interface Resolved {
  link: { id: number; store_id: number; organization_id: number };
  instance: {
    id: number;
    organization_id: number;
    store_id: number;
    reference: string;
    title: string;
    status: string;
    current_stage_key: string;
    subject_type: string | null;
    subject_id: number | null;
    created_at: Date;
    stage_entered_at: Date;
    completed_at: Date | null;
  };
  definition: WorkflowDefinitionV1;
}

/**
 * Public side of the tracking portal: what the requester sees and the two
 * things they may do (send a pending document, reply). The store comes from the
 * request domain; an unknown, revoked, expired or foreign-store token is a 404.
 * Nothing internal leaves here: no comments, assignees, e-mails or data fields.
 */
@Injectable()
export class WorkflowTrackingPublicService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly dossiers: DossiersService,
    private readonly events: WorkflowEventsService,
    private readonly uploads: WorkflowPublicUploadsService,
  ) {}

  async get(token: string) {
    const r = await this.resolve(token);
    await this.prisma.withoutScope().workflow_tracking_links.updateMany({
      where: { id: r.link.id, store_id: r.link.store_id },
      data: { last_used_at: new Date() },
    });
    const stage = r.definition.stages.find((s) => s.key === r.instance.current_stage_key) ?? null;
    const store = await this.prisma.withoutScope().stores.findFirst({
      where: { id: r.link.store_id },
      select: { name: true },
    });
    const pending = await this.inContext(r.link, () => this.pending(r.instance, stage));
    return {
      store: { name: store?.name ?? '' },
      reference: r.instance.reference,
      flow: { name: r.definition.name },
      status: r.instance.status,
      current_stage: stage ? { name: stage.name } : null,
      started_at: r.instance.created_at,
      entered_at: r.instance.stage_entered_at,
      completed_at: r.instance.completed_at,
      timeline: await this.timeline(r),
      pending,
      can_reply: r.instance.status === 'active',
    };
  }

  // ---- uploads of a pending external requirement -------------------------

  async initUpload(token: string, requirementKey: string, input: UploadInit) {
    const r = await this.resolveOpen(token);
    const req = this.externalRequirement(r.definition, r.instance.current_stage_key, requirementKey);
    return this.uploads.init(
      this.scope(r, requirementKey),
      { accept: req.accept, max_size_mb: req.max_size_mb },
      input,
    );
  }

  async putPart(token: string, requirementKey: string, uploadId: string, n: number, body: Buffer) {
    const r = await this.resolveOpen(token);
    this.externalRequirement(r.definition, r.instance.current_stage_key, requirementKey);
    return this.uploads.putPart(this.scope(r, requirementKey), uploadId, n, body);
  }

  /** Joins the parts and puts the file in the dossier under the requirement key. */
  async completeUpload(token: string, requirementKey: string, uploadId: string) {
    const r = await this.resolveOpen(token);
    const req = this.externalRequirement(r.definition, r.instance.current_stage_key, requirementKey);
    const scope = this.scope(r, requirementKey);
    const file = await this.uploads.complete(scope, uploadId);
    if (file.status === 'consumed') {
      return { requirement_key: requirementKey, file_name: file.file_name, received: true };
    }
    const claimed = await this.uploads.consume(scope, uploadId);
    if (!claimed) return { requirement_key: requirementKey, file_name: file.file_name, received: true };
    try {
      await this.inContext(r.link, () =>
        this.prisma.$transaction(async (tx: WorkflowTx) => {
          await this.events.lockInstance(tx, r.link.store_id, r.instance.id);
          const dossier =
            (await this.dossiers.getByInstance(r.instance.id, tx)) ??
            (await this.dossiers.createForInstance(tx, r.instance));
          await this.dossiers.addFileItem(tx, {
            dossier_id: dossier.id,
            file_id: file.stored_file_id,
            stage_key: r.instance.current_stage_key,
            requirement_key: requirementKey,
            field_key: null,
            actor: PUBLIC_ACTOR,
          });
          await this.events.append(tx, {
            store_id: r.link.store_id,
            instance_id: r.instance.id,
            type: 'external_upload',
            actor: PUBLIC_ACTOR,
            payload: {
              requirement_key: requirementKey,
              label: req.label,
              file_name: file.file_name,
              size_bytes: file.size_bytes,
              file_id: file.stored_file_id,
            },
          });
        }),
      );
    } catch (e) {
      // Give the session back so the requester can retry the same upload.
      await this.prisma.withoutScope().workflow_upload_sessions.updateMany({
        where: { public_id: uploadId, store_id: r.link.store_id, status: 'consumed' },
        data: { status: 'completed' },
      });
      throw e;
    }
    return { requirement_key: requirementKey, file_name: file.file_name, received: true };
  }

  // ---- reply -------------------------------------------------------------

  async reply(token: string, message: string) {
    const text = (message ?? '').trim();
    if (!text || text.length > TRACKING_MESSAGE_MAX_LENGTH) {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        `Escribe un mensaje de hasta ${TRACKING_MESSAGE_MAX_LENGTH} caracteres.`,
      );
    }
    const r = await this.resolveOpen(token);
    await this.inContext(r.link, () =>
      this.prisma.$transaction(async (tx: WorkflowTx) => {
        await this.events.lockInstance(tx, r.link.store_id, r.instance.id);
        await this.events.append(tx, {
          store_id: r.link.store_id,
          instance_id: r.instance.id,
          type: 'external_message',
          actor: PUBLIC_ACTOR,
          payload: { message: text },
        });
      }),
    );
    return { received: true };
  }

  // ---- internals ---------------------------------------------------------

  private scope(
    r: { link: { id: number; store_id: number; organization_id: number }; instance: { id: number } },
    requirementKey: string,
  ): UploadScope {
    return {
      store_id: r.link.store_id,
      organization_id: r.link.organization_id,
      tracking_link_id: r.link.id,
      folder: `workflows/${r.instance.id}`,
      requirement_key: requirementKey,
    };
  }

  private externalRequirement(
    definition: WorkflowDefinitionV1,
    stageKey: string,
    key: string,
  ): UploadRequirement {
    const stage = definition.stages.find((s) => s.key === stageKey);
    const req = (stage?.requirements ?? []).find(
      (x): x is UploadRequirement => x.kind === 'upload' && x.key === key && x.external === true,
    );
    if (!req) {
      throw new VendixHttpException(
        ErrorCodes.DOCUMENT_TARGET_INVALID,
        'Este documento ya no se puede enviar desde el enlace.',
      );
    }
    return req;
  }

  /** External upload requirements of the current stage that have no active item yet. */
  private async pending(instance: { id: number; status: string }, stage: WorkflowStageDef | null) {
    if (!stage || instance.status !== 'active') return [];
    const wanted = (stage.requirements ?? []).filter(
      (x): x is UploadRequirement => x.kind === 'upload' && x.external === true,
    );
    if (wanted.length === 0) return [];
    const dossier = await this.dossiers.getByInstance(instance.id);
    const out: Array<{ key: string; label: string; accept: string[] | null; max_size_mb: number | null }> = [];
    for (const req of wanted) {
      const done = dossier ? await this.dossiers.hasActiveItem(dossier.id, req.key) : false;
      if (!done) {
        out.push({
          key: req.key,
          label: req.label,
          accept: req.accept ?? null,
          max_size_mb: req.max_size_mb ?? null,
        });
      }
    }
    return out;
  }

  /** Stage changes, upload/reply events and the final outcome: nothing else. */
  private async timeline(r: Resolved): Promise<TrackingTimelineItem[]> {
    const events = await this.prisma.withoutScope().workflow_instance_events.findMany({
      where: { instance_id: r.instance.id, store_id: r.link.store_id },
      orderBy: { seq: 'asc' },
      select: { type: true, from_stage_key: true, to_stage_key: true, occurred_at: true, payload: true },
    });
    const stageOf = (k: string | null) => r.definition.stages.find((s) => s.key === k);
    const out: TrackingTimelineItem[] = [];
    for (const e of events) {
      const at = new Date(e.occurred_at).toISOString();
      const payload = (e.payload ?? {}) as Record<string, unknown>;
      if (e.type === 'started') {
        out.push({ type: 'started', label: 'Solicitud recibida', detail: null, at });
      } else if (e.type === 'cancelled') {
        out.push({ type: 'cancelled', label: 'Solicitud cancelada', detail: null, at });
      } else if (e.type === 'external_upload') {
        out.push({
          type: 'external_upload',
          label: 'Documento enviado',
          detail: typeof payload.label === 'string' ? payload.label : null,
          at,
        });
      } else if (e.type === 'external_message') {
        out.push({
          type: 'external_message',
          label: 'Respuesta del solicitante',
          detail: typeof payload.message === 'string' ? payload.message : null,
          at,
        });
      } else if (e.to_stage_key && e.to_stage_key !== e.from_stage_key) {
        const to = stageOf(e.to_stage_key);
        if (to && to.type !== 'end') {
          out.push({ type: 'stage', label: `Pasó a «${to.name}»`, detail: null, at });
        }
      }
    }
    const closedAt = r.instance.completed_at ? new Date(r.instance.completed_at).toISOString() : null;
    if (r.instance.status === 'completed' && closedAt) {
      out.push({ type: 'completed', label: 'Solicitud completada', detail: null, at: closedAt });
    } else if (r.instance.status === 'rejected' && closedAt) {
      out.push({ type: 'rejected', label: 'Solicitud rechazada', detail: null, at: closedAt });
    }
    return out;
  }

  private inContext<T>(
    link: { store_id: number; organization_id: number },
    fn: () => Promise<T>,
  ): Promise<T> {
    return RequestContextService.runIsolated(
      {
        store_id: link.store_id,
        organization_id: link.organization_id,
        is_super_admin: false,
        is_owner: false,
      },
      fn,
    );
  }

  private async resolveOpen(token: string) {
    const r = await this.resolve(token);
    if (r.instance.status !== 'active') {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_INSTANCE_CLOSED);
    }
    return r;
  }

  private async resolve(token: string): Promise<Resolved> {
    const storeId = RequestContextService.getStoreId();
    const notFound = () => new VendixHttpException(ErrorCodes.WORKFLOW_PUBLIC_NOT_FOUND);
    if (!storeId || typeof token !== 'string' || token.length < 20 || token.length > 200) {
      throw notFound();
    }
    const db = this.prisma.withoutScope();
    if (!(await storeAllowsFlows(db as never, storeId))) throw notFound();
    const link = await db.workflow_tracking_links.findFirst({
      where: { token_hash: hashTrackingToken(token), store_id: storeId },
    });
    if (!link || link.revoked_at || new Date(link.expires_at).getTime() <= Date.now()) {
      throw notFound();
    }
    const instance = await db.workflow_instances.findFirst({
      where: { id: link.instance_id, store_id: storeId },
    });
    if (!instance) throw notFound();
    const version = await db.workflow_versions.findFirst({
      where: { id: instance.version_id, store_id: storeId },
      select: { definition: true },
    });
    if (!version) throw notFound();
    return { link, instance, definition: version.definition as unknown as WorkflowDefinitionV1 };
  }
}
