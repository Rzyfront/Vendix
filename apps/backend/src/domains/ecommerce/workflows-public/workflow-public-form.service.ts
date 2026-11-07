import { Injectable } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { WorkflowDefinitionV1, startStage } from '@common/workflows/contract';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { DossiersService } from '../../store/documents/dossiers.service';
import { WorkflowTx } from '../../store/workflows/engine/workflow-engine.types';
import { WorkflowEngineService } from '../../store/workflows/engine/workflow-engine.service';
import { WorkflowTrackingLinksService } from '../../store/workflows/tracking/workflow-tracking-links.service';
import {
  UploadScope,
  WorkflowPublicUploadsService,
} from '../../store/workflows/public-link/workflow-public-uploads.service';
import { WorkflowPublicCaptchaService } from './workflow-public-captcha.service';
import {
  hashPublicToken,
  publicFormAvailability,
  submissionKey,
  PUBLIC_FORM_UNAVAILABLE_MESSAGES,
} from '../../store/workflows/public-link/workflow-public-link.rules';
import { storeAllowsFlows } from '../../store/workflows/engine/workflow-industry';
import { publicIdempotencyKey } from '../../store/workflows/engine/workflow-idempotency';
import { InitPublicUploadDto } from './dto/init-public-upload.dto';
import { SubmitPublicWorkflowFormDto } from './dto/submit-public-workflow-form.dto';

/** The values of a public form are small: anything bigger is abuse. */
export const PUBLIC_FORM_MAX_VALUES_BYTES = 50_000;

/**
 * Public form by link. The store comes from the request domain (the
 * `DomainResolverMiddleware` runs on `/ecommerce/` routes); the token is only
 * ever compared by its sha256, and a link that belongs to another store, is
 * inactive or has expired answers 404 exactly like an unknown one.
 */
@Injectable()
export class WorkflowPublicFormService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly engine: WorkflowEngineService,
    private readonly captcha: WorkflowPublicCaptchaService,
    private readonly uploads: WorkflowPublicUploadsService,
    private readonly tracking: WorkflowTrackingLinksService,
    private readonly dossiers: DossiersService,
  ) {}

  /** Chunked-upload scope of a form field of this link. */
  uploadScope(
    link: { id: number; store_id: number; organization_id: number },
    fieldKey?: string,
  ): UploadScope {
    return {
      store_id: link.store_id,
      organization_id: link.organization_id,
      public_link_id: link.id,
      folder: 'workflows/public',
      field_key: fieldKey,
    };
  }

  /** A fresh proof-of-work challenge for this link. */
  async captchaChallenge(token: string) {
    const { link } = await this.resolve(token);
    return this.captcha.issue(link.id);
  }

  /** Opens a chunked upload for a `file` field of the start form. */
  async initUpload(token: string, input: InitPublicUploadDto) {
    const { link, definition } = await this.resolve(token);
    const availability = publicFormAvailability(definition);
    if (!availability.available) throw new VendixHttpException(ErrorCodes.WORKFLOW_PUBLIC_NOT_FOUND);
    const stage = startStage(definition)!;
    const field = definition.fields.find((f) => f.key === input.field_key);
    if (!field || field.type !== 'file' || !(stage.form?.fields ?? []).includes(field.key)) {
      throw new VendixHttpException(
        ErrorCodes.WORKFLOW_UPLOAD_INVALID,
        `El campo "${input.field_key ?? ''}" no es un campo de archivo de este formulario.`,
      );
    }
    const grant = link.captcha_required ? await this.uploadGrant(link.id, input) : undefined;
    const session = await this.uploads.init(
      this.uploadScope(link, field.key),
      { accept: field.accept, max_size_mb: field.max_size_mb },
      input,
    );
    return grant ? { ...session, upload_grant: grant } : session;
  }

  /** A valid grant is reused as is; otherwise a solved proof is spent to issue one. */
  private async uploadGrant(linkId: number, input: InitPublicUploadDto): Promise<string> {
    if (this.captcha.verifyUploadGrant(linkId, input.upload_grant)) return input.upload_grant!;
    if (!input.captcha) throw new VendixHttpException(ErrorCodes.WORKFLOW_PUBLIC_UPLOAD_PROOF_REQUIRED);
    await this.captcha.verify(linkId, input.captcha);
    return this.captcha.issueUploadGrant(linkId);
  }

  async putUploadPart(token: string, uploadId: string, n: number, body: Buffer) {
    const { link } = await this.resolve(token);
    return this.uploads.putPart(this.uploadScope(link), uploadId, n, body);
  }

  async completeUpload(token: string, uploadId: string) {
    const { link } = await this.resolve(token);
    const done = await this.uploads.complete(this.uploadScope(link), uploadId);
    return { upload_id: done.upload_id, file_name: done.file_name, size_bytes: done.size_bytes };
  }

  async get(token: string) {
    const { link, definition, def } = await this.resolve(token);
    const store = await this.prisma.withoutScope().stores.findFirst({
      where: { id: link.store_id },
      select: { name: true },
    });
    const base = {
      store: { name: store?.name ?? '' },
      flow: { name: definition.name, description: definition.description ?? def.description ?? null },
      privacy_notice: this.privacyNotice(store?.name ?? ''),
      captcha_required: link.captcha_required === true,
    };
    const availability = publicFormAvailability(definition);
    if (!availability.available) {
      return {
        available: false,
        reason: availability.reason,
        message: PUBLIC_FORM_UNAVAILABLE_MESSAGES[availability.reason],
        ...base,
        fields: [],
        steps: [],
      };
    }
    const stage = startStage(definition)!;
    const fields = (stage.form?.fields ?? [])
      .map((k) => definition.fields.find((f) => f.key === k))
      .filter((f): f is NonNullable<typeof f> => !!f)
      .map((f) => ({
        key: f.key,
        type: f.type,
        label: f.label,
        required: f.required ?? false,
        help: f.help ?? null,
        options: f.options ?? null,
        visible_when: f.visible_when ?? null,
        ...(f.type === 'file'
          ? { accept: f.accept ?? null, max_size_mb: f.max_size_mb ?? null }
          : {}),
      }));
    // Multi-step is presentational: the server still validates the whole form.
    const keys = fields.map((f) => f.key);
    const steps = stage.form?.steps?.length
      ? stage.form.steps.map((st) => ({
          title: st.title,
          fields: st.fields.filter((k) => keys.includes(k)),
        }))
      : [{ title: 'Datos', fields: keys }];
    return { available: true, ...base, fields, steps };
  }

  async submit(token: string, dto: SubmitPublicWorkflowFormDto) {
    if (dto.accept_privacy !== true) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_PUBLIC_CONSENT_REQUIRED);
    }
    if (Buffer.byteLength(JSON.stringify(dto.values ?? {})) > PUBLIC_FORM_MAX_VALUES_BYTES) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_PUBLIC_PAYLOAD_TOO_LARGE);
    }
    const { link, definition } = await this.resolve(token);
    const availability = publicFormAvailability(definition);
    if (!availability.available) {
      throw new VendixHttpException(
        ErrorCodes.WORKFLOW_PUBLIC_LINK_UNAVAILABLE,
        PUBLIC_FORM_UNAVAILABLE_MESSAGES[availability.reason],
        { reason: availability.reason },
      );
    }
    if (link.captcha_required) await this.captcha.verify(link.id, dto.captcha);
    const stage = startStage(definition)!;
    // A retry of an already accepted submission finds its uploads consumed.
    const retry = !!(await this.prisma.withoutScope().workflow_instance_events.findFirst({
      where: {
        store_id: link.store_id,
        idempotency_key: publicIdempotencyKey(submissionKey(token, dto.submission_id)),
      },
      select: { id: true },
    }));
    const sessions = await this.fileSessions(
      link,
      definition,
      stage.form?.fields ?? [],
      dto.values ?? {},
      retry,
    );
    const result = await RequestContextService.runIsolated(
      {
        store_id: link.store_id,
        organization_id: link.organization_id,
        is_super_admin: false,
        is_owner: false,
      },
      () =>
        this.engine.startPublic({
          linkId: link.id,
          definitionId: link.definition_id,
          values: dto.values ?? {},
          contact: {
            name: dto.contact.name.trim(),
            email: dto.contact.email?.trim() || null,
            phone: dto.contact.phone?.trim() || null,
          },
          idempotencyKey: submissionKey(token, dto.submission_id),
          fileFields: sessions.map((x) => x.field_key),
        }),
    );
    await this.attachFiles(link, result.instance, stage.key, sessions);
    const tracking = await this.tracking.createForSubmit({
      store_id: link.store_id,
      organization_id: link.organization_id,
      instance_id: result.instance.id,
      reference: result.instance.reference,
      flow_name: definition.name,
      contact_name: dto.contact.name.trim(),
      contact_email: dto.contact.email?.trim() || null,
      send_email: !result.replayed,
    });
    return { reference: result.instance.reference, tracking_url: tracking.tracking_url };
  }

  /** Completed uploads referenced by the file fields of the submit. */
  private async fileSessions(
    link: { id: number; store_id: number; organization_id: number },
    definition: WorkflowDefinitionV1,
    formKeys: string[],
    values: Record<string, unknown>,
    retry: boolean,
  ) {
    const out: Array<{ field_key: string; upload_id: string; stored_file_id: number }> = [];
    for (const f of definition.fields.filter((x) => x.type === 'file')) {
      const v = values[f.key];
      if (v === undefined || v === null || v === '') continue;
      if (!formKeys.includes(f.key) || typeof v !== 'string') {
        throw new VendixHttpException(
          ErrorCodes.WORKFLOW_UPLOAD_INVALID,
          `El campo "${f.label}" no recibe ese valor.`,
          { field: f.key },
        );
      }
      const session = await this.uploads.completedForField(this.uploadScope(link, f.key), f.key, v, retry);
      out.push({ field_key: f.key, upload_id: v, stored_file_id: session.stored_file_id as number });
    }
    return out;
  }

  /** Puts each claimed upload in the new request's dossier (a retry attaches what is left). */
  private async attachFiles(
    link: { id: number; store_id: number; organization_id: number },
    instance: { id: number; organization_id: number; store_id: number; title: string; subject_type: string | null; subject_id: number | null },
    stageKey: string,
    sessions: Array<{ field_key: string; upload_id: string; stored_file_id: number }>,
  ) {
    for (const s of sessions) {
      const scope = this.uploadScope(link, s.field_key);
      if (!(await this.uploads.consume(scope, s.upload_id))) continue;
      try {
        await RequestContextService.runIsolated(
          {
            store_id: link.store_id,
            organization_id: link.organization_id,
            is_super_admin: false,
            is_owner: false,
          },
          () =>
            this.prisma.$transaction(async (tx: WorkflowTx) => {
              const dossier =
                (await this.dossiers.getByInstance(instance.id, tx)) ??
                (await this.dossiers.createForInstance(tx, instance));
              await this.dossiers.addFileItem(tx, {
                dossier_id: dossier.id,
                file_id: s.stored_file_id,
                stage_key: stageKey,
                field_key: s.field_key,
                actor: { type: 'public', id: null },
              });
            }),
        );
      } catch (e) {
        await this.prisma.withoutScope().workflow_upload_sessions.updateMany({
          where: { public_id: s.upload_id, store_id: link.store_id, status: 'consumed' },
          data: { status: 'completed' },
        });
        throw e;
      }
    }
  }

  private privacyNotice(storeName: string): string {
    const who = storeName ? storeName : 'la organización';
    return (
      `Al enviar este formulario autorizas a ${who} a tratar tus datos personales ` +
      'únicamente para gestionar tu solicitud, conforme a la Ley 1581 de 2012.'
    );
  }

  private async resolve(token: string) {
    const storeId = RequestContextService.getStoreId();
    const notFound = () => new VendixHttpException(ErrorCodes.WORKFLOW_PUBLIC_NOT_FOUND);
    if (!storeId || typeof token !== 'string' || token.length < 20 || token.length > 200) {
      throw notFound();
    }
    const db = this.prisma.withoutScope();
    if (!(await storeAllowsFlows(db as never, storeId))) throw notFound();
    const link = await db.workflow_public_links.findFirst({
      where: { token_hash: hashPublicToken(token), store_id: storeId, is_active: true },
    });
    if (!link || (link.expires_at && new Date(link.expires_at).getTime() <= Date.now())) {
      throw notFound();
    }
    const def = await db.workflow_definitions.findFirst({
      where: { id: link.definition_id, store_id: storeId },
    });
    // P2.11: a switched-off flow shows its public form as unavailable.
    if (!def || def.status !== 'active' || !def.published_version_id || def.is_enabled === false) {
      throw notFound();
    }
    const version = await db.workflow_versions.findFirst({
      where: { id: def.published_version_id, store_id: storeId },
      select: { definition: true },
    });
    if (!version) throw notFound();
    return { link, def, definition: version.definition as unknown as WorkflowDefinitionV1 };
  }
}
