import { Injectable } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { WorkflowDefinitionV1, startStage } from '@common/workflows/contract';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { WorkflowEngineService } from '../../store/workflows/engine/workflow-engine.service';
import {
  hashPublicToken,
  publicFormAvailability,
  submissionKey,
  PUBLIC_FORM_UNAVAILABLE_MESSAGES,
} from '../../store/workflows/public-link/workflow-public-link.rules';
import { storeAllowsFlows } from '../../store/workflows/engine/workflow-industry';
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
  ) {}

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
    };
    const availability = publicFormAvailability(definition);
    if (!availability.available) {
      return {
        available: false,
        reason: availability.reason,
        message: PUBLIC_FORM_UNAVAILABLE_MESSAGES[availability.reason],
        ...base,
        fields: [],
      };
    }
    const stage = startStage(definition)!;
    const fields = (stage.form?.fields ?? [])
      .map((k) => definition.fields.find((f) => f.key === k))
      .filter((f): f is NonNullable<typeof f> => !!f && f.type !== 'file')
      .map((f) => ({
        key: f.key,
        type: f.type,
        label: f.label,
        required: f.required ?? false,
        help: f.help ?? null,
        options: f.options ?? null,
        visible_when: f.visible_when ?? null,
      }));
    return { available: true, ...base, fields };
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
        }),
    );
    return { reference: result.instance.reference };
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
    if (!def || def.status !== 'active' || !def.published_version_id) throw notFound();
    const version = await db.workflow_versions.findFirst({
      where: { id: def.published_version_id, store_id: storeId },
      select: { definition: true },
    });
    if (!version) throw notFound();
    return { link, def, definition: version.definition as unknown as WorkflowDefinitionV1 };
  }
}
