import { Injectable } from '@nestjs/common';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { WorkflowStageDef } from '@common/workflows/contract';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { DossiersService } from '../../documents/dossiers.service';
import { StoredFilesService } from '../../documents/stored-files.service';
import { WorkflowAuditService } from '../audit/workflow-audit.service';
import { WorkflowAssignmentService } from '../engine/workflow-assignment.service';
import { WorkflowTaskRow } from '../engine/workflow-engine.types';
import {
  WorkflowCallContext,
  WorkflowLoaderService,
} from '../engine/workflow-loader.service';
import { WorkflowInstancesService } from '../instances/workflow-instances.service';

const MANAGE_PERMISSION = 'store:workflows:manage';
const DOCUMENTS_READ = 'store:documents:read';
const OPEN = ['open', 'claimed'];

export interface UploadedBlob {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
}

export interface WorkflowFileTarget {
  requirement_key?: string;
  field_key?: string;
}

/**
 * Document operations tied to a workflow instance: attach a file to the CURRENT
 * stage (requirement `upload` or a `file` form field) and download with the
 * participant rule. Writes never touch `instance.data`.
 */
@Injectable()
export class WorkflowFilesService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly loader: WorkflowLoaderService,
    private readonly assignment: WorkflowAssignmentService,
    private readonly dossiers: DossiersService,
    private readonly files: StoredFilesService,
    private readonly instances: WorkflowInstancesService,
    /** Append-only audit trail (P7.2): required, so no path runs unaudited. */
    private readonly audit: WorkflowAuditService,
  ) {}

  async upload(instanceId: number, blob: UploadedBlob | undefined, target: WorkflowFileTarget) {
    if (!blob?.buffer) throw new VendixHttpException(ErrorCodes.DOCUMENT_FILE_REQUIRED);
    const hasReq = !!target.requirement_key;
    const hasField = !!target.field_key;
    if (hasReq === hasField) {
      throw new VendixHttpException(
        ErrorCodes.DOCUMENT_TARGET_INVALID,
        'Indica "requirement_key" o "field_key" (solo uno de los dos).',
      );
    }
    const ctx = this.loader.context();
    const instance = await this.loader.loadInstance(this.prisma, instanceId);
    if (instance.status !== 'active') {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_INSTANCE_CLOSED);
    }
    await this.assertMayUpload(ctx, instance);

    const definition = await this.loader.loadDefinition(this.prisma, instance.version_id);
    const stage = this.loader.currentStage(definition, instance);
    const rules = this.resolveTarget(definition.fields, stage, target);

    const actor = { type: 'user' as const, id: ctx.user_id };
    const file = await this.files.upload({
      buffer: blob.buffer,
      originalName: blob.originalname,
      mimeType: blob.mimetype,
      source: 'upload',
      accept: rules.accept,
      maxSizeMb: rules.max_size_mb,
      folder: `workflows/${instance.id}`,
      actor,
    });
    try {
      const item = await this.prisma.$transaction(async (tx: any) => {
        const dossier =
          (await this.dossiers.getByInstance(instance.id, tx)) ??
          (await this.dossiers.createForInstance(tx, instance));
        return this.dossiers.addFileItem(tx, {
          dossier_id: dossier.id,
          file_id: file.id,
          stage_key: stage.key,
          requirement_key: target.requirement_key ?? null,
          field_key: target.field_key ?? null,
          actor,
        });
      });
      return {
        file_id: file.id,
        item_id: item.id,
        requirement_key: target.requirement_key ?? null,
        field_key: target.field_key ?? null,
        stage_key: stage.key,
        original_name: file.original_name,
        mime_type: file.mime_type,
        size_bytes: file.size_bytes,
        sha256: file.sha256,
      };
    } catch (e) {
      await this.files.discard(file);
      throw e;
    }
  }

  /** Signed download URL: `documents:read` / owner, or a participant of the file's instance. */
  async download(fileId: number) {
    const ctx = this.loader.context();
    const privileged =
      ctx.is_owner || ctx.is_super_admin || ctx.permissions.includes(DOCUMENTS_READ);
    if (!privileged) {
      let allowed = false;
      for (const id of await this.dossiers.instanceIdsOfFile(fileId)) {
        if (await this.instances.canSee(id)) {
          allowed = true;
          break;
        }
      }
      // 404 (not 403): do not reveal that the file exists.
      if (!allowed) throw new VendixHttpException(ErrorCodes.DOCUMENT_NOT_FOUND);
    }
    await this.auditDownload(fileId, ctx.store_id);
    return this.files.signedDownloadUrl(fileId);
  }

  /**
   * Fail-closed: the access is written BEFORE the signed URL exists, so a
   * file nobody could audit is never handed out. The PDF of an issued
   * document is recorded as such.
   */
  private async auditDownload(fileId: number, storeId: number): Promise<void> {
    const file = await this.files.findOne(fileId);
    const issued: { id: number; reference: string; title: string; workflow_instance_id: number | null } | null =
      await this.prisma.issued_documents.findFirst({
        where: { file_id: fileId, store_id: storeId },
        select: { id: true, reference: true, title: true, workflow_instance_id: true },
      });
    const instanceId = issued?.workflow_instance_id ?? (await this.dossiers.instanceIdsOfFile(fileId))[0] ?? null;
    await this.audit.recordNow(
      issued
        ? {
            action: 'document.issued_downloaded',
            target_type: 'issued_document',
            target_id: issued.id,
            instance_id: instanceId,
            summary: `Descargó el documento emitido ${issued.reference} «${issued.title}»`,
            details: { file_id: fileId, file_name: file.original_name, sha256: file.sha256 },
          }
        : {
            action: 'document.file_downloaded',
            target_type: 'file',
            target_id: fileId,
            instance_id: instanceId,
            summary: `Descargó el archivo «${file.original_name}»`,
            details: { file_name: file.original_name, mime_type: file.mime_type, sha256: file.sha256 },
          },
    );
  }

  private async assertMayUpload(
    ctx: WorkflowCallContext,
    instance: { id: number; current_stage_key: string; stage_entry_seq: number },
  ) {
    if (ctx.is_owner || ctx.is_super_admin || ctx.permissions.includes(MANAGE_PERMISSION)) {
      return;
    }
    if (ctx.user_id === null) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_TASK_FORBIDDEN);
    }
    const tasks: WorkflowTaskRow[] = await this.prisma.workflow_tasks.findMany({
      where: {
        store_id: ctx.store_id,
        instance_id: instance.id,
        stage_key: instance.current_stage_key,
        stage_entry_seq: instance.stage_entry_seq,
        status: { in: OPEN },
      },
    });
    for (const task of tasks) {
      if (
        await this.assignment.canActQuietly(
          this.prisma,
          task,
          ctx.user_id,
          ctx.store_id,
          ctx.organization_id,
        )
      ) {
        return;
      }
    }
    throw new VendixHttpException(ErrorCodes.WORKFLOW_TASK_FORBIDDEN);
  }

  /** The target must belong to the CURRENT stage; returns its accept / size rules. */
  private resolveTarget(
    fields: Array<{ key: string; type: string; accept?: string[]; max_size_mb?: number }>,
    stage: WorkflowStageDef,
    target: WorkflowFileTarget,
  ): { accept?: string[]; max_size_mb?: number } {
    if (target.requirement_key) {
      const req = (stage.requirements ?? []).find(
        (r) => r.kind === 'upload' && r.key === target.requirement_key,
      );
      if (!req || req.kind !== 'upload') {
        throw new VendixHttpException(
          ErrorCodes.DOCUMENT_TARGET_INVALID,
          `El requisito "${target.requirement_key}" no existe en la etapa actual.`,
        );
      }
      return { accept: req.accept, max_size_mb: req.max_size_mb };
    }
    const field = fields.find((f) => f.key === target.field_key);
    if (
      !field ||
      field.type !== 'file' ||
      !(stage.form?.fields ?? []).includes(field.key)
    ) {
      throw new VendixHttpException(
        ErrorCodes.DOCUMENT_TARGET_INVALID,
        `El campo "${target.field_key}" no es un campo de archivo del formulario de la etapa actual.`,
      );
    }
    return { accept: field.accept, max_size_mb: field.max_size_mb };
  }
}
