import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { WorkflowDefinitionV1 } from '@common/workflows/contract';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { WorkflowAccessPolicy } from '../access/workflow-access.policy';
import { declaresTrigger, generateMailboxLocalPart } from './workflow-inbound.rules';

/** Same approved domains as the document inbox (`facturas-` addresses). */
const APPROVED_DOMAINS = {
  production: 'recepcion.vendix.online',
  staging: 'recepcion-stg.vendix.online',
} as const;

const STATE_SELECT = {
  id: true,
  local_part: true,
  domain: true,
  is_active: true,
  last_received_at: true,
  created_at: true,
} as const;

/**
 * Admin side of the per-flow mailbox (`store:workflows:design`). The state
 * follows "Quién ve" and every change follows "Quién diseña" (P7.3).
 */
@Injectable()
export class WorkflowMailboxService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly config: ConfigService,
    private readonly access: WorkflowAccessPolicy,
  ) {}

  private ctx() {
    const c = RequestContextService.getContext();
    if (!c?.store_id || !c.organization_id || !c.user_id) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_DEFINITION_NOT_FOUND);
    }
    return { store_id: c.store_id, organization_id: c.organization_id, user_id: c.user_id };
  }

  /** Reception domain of the SES pipeline; the mailbox cannot exist without it. */
  private receptionDomain(): string {
    const environment = this.config.get<string>('EMAIL_RECEPTION_ENVIRONMENT', 'staging');
    if (environment !== 'production' && environment !== 'staging') {
      throw new VendixHttpException(ErrorCodes.EMAIL_RECEPTION_UNAVAILABLE);
    }
    const domain = this.config.get<string>(
      'EMAIL_RECEPTION_DOMAIN',
      APPROVED_DOMAINS[environment],
    );
    if (domain !== APPROVED_DOMAINS[environment]) {
      throw new VendixHttpException(ErrorCodes.EMAIL_RECEPTION_UNAVAILABLE);
    }
    return domain;
  }

  private async loadDefinition(storeId: number, id: number, use: 'view' | 'design') {
    const def = await this.prisma.workflow_definitions.findFirst({
      where: { id, store_id: storeId },
      select: { id: true, status: true, published_version_id: true },
    });
    if (!def) throw new VendixHttpException(ErrorCodes.WORKFLOW_DEFINITION_NOT_FOUND);
    if (use === 'view') await this.access.assertCanView(id);
    else await this.access.assertCanDesign(id);
    return def;
  }

  private async assertDeclaresEmail(
    storeId: number,
    def: { status: string; published_version_id: number | null },
  ) {
    const unavailable = (message: string) =>
      new VendixHttpException(ErrorCodes.WORKFLOW_INBOUND_UNAVAILABLE, message);
    if (def.status !== 'active' || !def.published_version_id) {
      throw unavailable('Publica el flujo antes de activar su buzón de correo.');
    }
    const version = await this.prisma.workflow_versions.findFirst({
      where: { id: def.published_version_id, store_id: storeId },
      select: { definition: true },
    });
    const published = version?.definition as WorkflowDefinitionV1 | undefined;
    if (!published || !declaresTrigger(published, 'email')) {
      throw unavailable(
        'La versión publicada no tiene el disparador "Correo entrante". Agrégalo en Disparadores y publica de nuevo.',
      );
    }
  }

  private async view(
    storeId: number,
    box: {
      id: number;
      local_part: string;
      domain: string;
      is_active: boolean;
      last_received_at: Date | null;
      created_at: Date;
    },
  ) {
    const received_24h = await this.prisma.workflow_mailbox_messages.count({
      where: {
        store_id: storeId,
        mailbox_id: box.id,
        created_at: { gte: new Date(Date.now() - 24 * 3_600_000) },
      },
    });
    return {
      address: `${box.local_part}@${box.domain}`,
      is_active: box.is_active,
      last_received_at: box.last_received_at,
      created_at: box.created_at,
      received_24h,
    };
  }

  /** The mailbox of the flow, or null when never activated. */
  async state(definitionId: number) {
    const c = this.ctx();
    await this.loadDefinition(c.store_id, definitionId, 'view');
    const box = await this.prisma.workflow_mailboxes.findFirst({
      where: { store_id: c.store_id, definition_id: definitionId },
      select: STATE_SELECT,
    });
    return box ? this.view(c.store_id, box) : null;
  }

  /** Creates the mailbox, or switches a deactivated one back on (same address). */
  async activate(definitionId: number) {
    const c = this.ctx();
    const def = await this.loadDefinition(c.store_id, definitionId, 'design');
    await this.assertDeclaresEmail(c.store_id, def);
    const domain = this.receptionDomain();
    const existing = await this.prisma.workflow_mailboxes.findFirst({
      where: { store_id: c.store_id, definition_id: definitionId },
      select: { id: true, is_active: true },
    });
    if (existing?.is_active) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_INBOUND_ALREADY_ACTIVE, 'El buzón ya está activo.');
    }
    if (existing) {
      return this.change(c.store_id, existing.id, { is_active: true, domain });
    }
    const created = await this.prisma.workflow_mailboxes.create({
      data: {
        organization_id: c.organization_id,
        store_id: c.store_id,
        definition_id: definitionId,
        local_part: generateMailboxLocalPart(),
        domain,
        is_active: true,
        created_by_user_id: c.user_id,
      },
      select: STATE_SELECT,
    });
    return this.view(c.store_id, created);
  }

  async update(definitionId: number, patch: { is_active: boolean }) {
    const c = this.ctx();
    const def = await this.loadDefinition(c.store_id, definitionId, 'design');
    const existing = await this.prisma.workflow_mailboxes.findFirst({
      where: { store_id: c.store_id, definition_id: definitionId },
      select: { id: true, is_active: true },
    });
    if (!existing) {
      throw new VendixHttpException(
        ErrorCodes.WORKFLOW_INBOUND_NOT_ACTIVATED,
        'Este flujo todavía no tiene buzón.',
      );
    }
    if (patch.is_active && !existing.is_active) {
      await this.assertDeclaresEmail(c.store_id, def);
      return this.change(c.store_id, existing.id, {
        is_active: true,
        domain: this.receptionDomain(),
      });
    }
    return this.change(c.store_id, existing.id, { is_active: patch.is_active });
  }

  private async change(storeId: number, id: number, data: Record<string, unknown>) {
    await this.prisma.workflow_mailboxes.updateMany({ where: { id, store_id: storeId }, data });
    const box = await this.prisma.workflow_mailboxes.findFirst({
      where: { id, store_id: storeId },
      select: STATE_SELECT,
    });
    if (!box) throw new VendixHttpException(ErrorCodes.WORKFLOW_INBOUND_NOT_ACTIVATED);
    return this.view(storeId, box);
  }
}
