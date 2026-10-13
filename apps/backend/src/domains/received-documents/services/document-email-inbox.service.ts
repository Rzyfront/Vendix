import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, document_reception_email_inboxes } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { FiscalScopeService } from '../../../common/services/fiscal-scope.service';
import { tryResolveTenantFiscalIdentity } from '../../../common/helpers/fiscal-identity.helper';
import { ErrorCodes } from '../../../common/errors/error-codes';
import { VendixHttpException } from '../../../common/errors/vendix-http.exception';
import { SubscriptionAccessService } from '../../store/subscriptions/services/subscription-access.service';
import type { ReceivedDocumentsReadContext } from './received-documents-context.service';
import type { ActivateDocumentEmailInboxDto, RotateDocumentEmailAddressDto, UpdateDocumentEmailInboxDto } from '../dto/document-email-reception.dto';
import { DOCUMENT_EMAIL_REASON_CODES, DocumentEmailConfiguration, DocumentEmailProcessingContext, DocumentEmailReasonCode, DocumentEmailSnapshot, DocumentEmailStatus } from '../interfaces/document-email-reception.interface';

type Inbox = document_reception_email_inboxes;
type ReadScope = Pick<ReceivedDocumentsReadContext, 'organization_id' | 'store_id' | 'accounting_entity_id'>;
const APPROVED_DOMAINS = { production: 'recepcion.vendix.online', staging: 'recepcion-stg.vendix.online' } as const;

@Injectable()
export class DocumentEmailInboxService {
  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly config: ConfigService,
    private readonly fiscalScopes: FiscalScopeService,
    private readonly subscriptions: SubscriptionAccessService,
  ) {}

  isPilotAvailable(storeId: number | null): boolean {
    if (this.config.get<string>('EMAIL_RECEPTION_ENABLED', 'false') !== 'true' || storeId == null) return false;
    const stores = this.config.get<string>('EMAIL_RECEPTION_STORE_ALLOWLIST', '').split(',').map((value) => value.trim());
    return stores.some((value) => /^\d+$/.test(value) && Number(value) === storeId);
  }

  /** Pure read; feature/subscription pause never hides historical health. */
  async status(ctx: ReadScope): Promise<DocumentEmailStatus> {
    const empty: DocumentEmailStatus = {
      pilot_available: this.isPilotAvailable(ctx.store_id), configured: false, enabled: false,
      active_inboxes: 0, state: 'inactive', first_valid_received_at: null, last_email_at: null,
      last_valid_received_at: null, last_error_code: null, not_processed_count: 0,
    };
    if (ctx.accounting_entity_id == null) return empty;
    const where = this.scopeWhere(ctx);
    // Organization consolidation returns only counts, never an address or another store's metadata.
    if (ctx.store_id == null) {
      const [configured, active] = await Promise.all([
        this.prisma.document_reception_email_inboxes.count({ where }),
        this.prisma.document_reception_email_inboxes.count({ where: { ...where, enabled: true } }),
      ]);
      return { ...empty, configured: configured > 0, active_inboxes: active };
    }
    const inbox = await this.prisma.document_reception_email_inboxes.findFirst({ where,
      select: { enabled: true, first_valid_received_at: true, last_email_at: true, last_valid_received_at: true, last_error_code: true },
    });
    if (!inbox) return empty;
    const notProcessed = await this.prisma.document_reception_email_messages.count({
      where: { ...where, archived_at: null, status: { in: ['received', 'processing', 'partial', 'not_processed', 'failed'] } },
    });
    return {
      ...empty, configured: true, enabled: inbox.enabled, active_inboxes: inbox.enabled && empty.pilot_available ? 1 : 0,
      state: !inbox.enabled || !empty.pilot_available ? 'paused' : notProcessed > 0 ? 'attention' : inbox.last_valid_received_at ? 'working' : 'waiting',
      first_valid_received_at: inbox.first_valid_received_at, last_email_at: inbox.last_email_at,
      last_valid_received_at: inbox.last_valid_received_at,
      last_error_code: this.safeReason(inbox.last_error_code), not_processed_count: notProcessed,
    };
  }

  async configuration(ctx: ReceivedDocumentsReadContext): Promise<DocumentEmailConfiguration> {
    this.assertStore(ctx);
    const inbox = ctx.accounting_entity_id == null ? null : await this.prisma.document_reception_email_inboxes.findFirst({ where: this.scopeWhere(ctx) });
    return this.toConfiguration(inbox);
  }

  async activate(ctx: ReceivedDocumentsReadContext, dto: ActivateDocumentEmailInboxDto): Promise<DocumentEmailConfiguration> {
    this.assertActor(ctx);
    if (dto.consent !== true || dto.policy_version !== this.policyVersion()) {
      throw new VendixHttpException(ErrorCodes.EMAIL_RECEPTION_CONSENT_REQUIRED);
    }
    await this.validateAuthority(ctx.organization_id, ctx.store_id!, ctx.accounting_entity_id);
    const delivery = this.deliveryConfiguration();
    // A store lock serializes first activation; the unique store key is the final database fence.
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`email-inbox:${ctx.organization_id}:${ctx.store_id}`}))`;
        const current = await tx.document_reception_email_inboxes.findFirst({ where: { organization_id: ctx.organization_id, store_id: ctx.store_id! } });
        if (current) {
          this.assertBinding(current, ctx.accounting_entity_id!);
          return this.toConfiguration(current);
        }
        const inbox = await tx.document_reception_email_inboxes.create({ data: {
          organization_id: ctx.organization_id, store_id: ctx.store_id!, accounting_entity_id: ctx.accounting_entity_id!,
          local_part: this.newLocalPart(), ...delivery, enabled: true, created_by: ctx.actor_id!, updated_by: ctx.actor_id!,
          policy_version: dto.policy_version, policy_accepted_at: new Date(),
        } });
        await this.audit(tx, ctx, inbox, 'CREATE', false);
        return this.toConfiguration(inbox);
      });
    } catch (error) {
      // Only a unique violation may converge on an already-created store inbox.
      if ((error as { code?: string })?.code !== 'P2002') throw error;
      const current = await this.prisma.document_reception_email_inboxes.findFirst({
        where: { organization_id: ctx.organization_id, store_id: ctx.store_id! },
      });
      if (!current) throw new VendixHttpException(ErrorCodes.EMAIL_RECEPTION_UNAVAILABLE);
      this.assertBinding(current, ctx.accounting_entity_id!);
      return this.toConfiguration(current);
    }
  }

  async update(ctx: ReceivedDocumentsReadContext, dto: UpdateDocumentEmailInboxDto): Promise<DocumentEmailConfiguration> {
    this.assertActor(ctx);
    if (typeof dto.enabled !== 'boolean') throw new VendixHttpException(ErrorCodes.SYS_VALIDATION_001);
    // Pausing must remain possible while fiscal/module gates are blocked.
    if (dto.enabled) await this.validateAuthority(ctx.organization_id, ctx.store_id!, ctx.accounting_entity_id);
    return this.mutate(ctx, dto.expected_version, { enabled: dto.enabled }, false);
  }

  async rotateAddress(ctx: ReceivedDocumentsReadContext, dto: RotateDocumentEmailAddressDto): Promise<DocumentEmailConfiguration> {
    this.assertActor(ctx);
    if (dto.confirmed !== true) throw new VendixHttpException(ErrorCodes.EMAIL_RECEPTION_CONSENT_REQUIRED);
    await this.validateAuthority(ctx.organization_id, ctx.store_id!, ctx.accounting_entity_id);
    return this.mutate(ctx, dto.expected_version, { local_part: this.newLocalPart(), ...this.deliveryConfiguration() }, true);
  }

  /** Exact SES envelope recipient only; transport can durably register paused business outcomes. */
  async lookupByAlias(recipient: string): Promise<DocumentEmailSnapshot | null> {
    const { domain, environment } = this.deliveryConfiguration();
    if (typeof recipient !== 'string') return null;
    const alias = /^(facturas-[0-9a-f]{32})@([^@]+)$/.exec(recipient);
    if (!alias || alias[2] !== domain) return null;
    const inbox = await this.prisma.document_reception_email_inboxes.findFirst({
      where: { local_part: alias[1], domain, environment },
      select: { id: true, organization_id: true, store_id: true, accounting_entity_id: true, local_part: true, domain: true, environment: true },
    });
    if (!inbox) return null;
    return { inbox_id: inbox.id, organization_id: inbox.organization_id, store_id: inbox.store_id,
      accounting_entity_id: inbox.accounting_entity_id, local_part: inbox.local_part, domain: inbox.domain, environment: inbox.environment };
  }

  async resolveByAlias(recipient: string): Promise<DocumentEmailProcessingContext | null> {
    const snapshot = await this.lookupByAlias(recipient);
    return snapshot ? this.revalidateSnapshot(snapshot) : null;
  }

  /** Accepted pre-rotation work keeps its address snapshot; a cosmetic config version does not cancel it. */
  async revalidateSnapshot(snapshot: DocumentEmailSnapshot): Promise<DocumentEmailProcessingContext> {
    const inbox = await this.prisma.document_reception_email_inboxes.findFirst({ where: {
      id: snapshot.inbox_id, organization_id: snapshot.organization_id, store_id: snapshot.store_id,
      accounting_entity_id: snapshot.accounting_entity_id,
    }, select: { enabled: true } });
    if (!inbox) throw new VendixHttpException(ErrorCodes.EMAIL_RECEPTION_FISCAL_GATE);
    if (!inbox.enabled) throw new VendixHttpException(ErrorCodes.EMAIL_RECEPTION_PAUSED);
    const delivery = this.deliveryConfiguration();
    if (snapshot.domain !== delivery.domain || snapshot.environment !== delivery.environment || !/^facturas-[0-9a-f]{32}$/.test(snapshot.local_part)) {
      throw new VendixHttpException(ErrorCodes.EMAIL_RECEPTION_FISCAL_GATE);
    }
    const authority = await this.validateAuthority(snapshot.organization_id, snapshot.store_id, snapshot.accounting_entity_id);
    return { ...snapshot, recipient_alias: `${snapshot.local_part}@${snapshot.domain}`, ...authority };
  }

  private async validateAuthority(organizationId: number, storeId: number, expectedEntity: number | null) {
    if (!this.isPilotAvailable(storeId)) throw new VendixHttpException(ErrorCodes.EMAIL_RECEPTION_UNAVAILABLE);
    const db = this.prisma.withoutScope();
    const [organization, store] = await Promise.all([
      db.organizations.findFirst({ where: { id: organizationId, state: 'active' }, select: { id: true, fiscal_scope: true, operating_scope: true } }),
      db.stores.findFirst({ where: { id: storeId, organization_id: organizationId, is_active: true }, select: { id: true, nit_type: true } }),
    ]);
    if (!organization || !store || expectedEntity == null) throw new VendixHttpException(ErrorCodes.EMAIL_RECEPTION_FISCAL_GATE);
    this.fiscalScopes.assertValidScopeCombination(organization.operating_scope, organization.fiscal_scope);
    // Passing the raw client bypasses FiscalScopeService's scope cache, not tenant validation.
    const entityId = await this.fiscalScopes.findFiscalAccountingEntityId({ organization_id: organizationId, store_id: storeId, tx: db });
    if (entityId !== expectedEntity) throw new VendixHttpException(ErrorCodes.EMAIL_RECEPTION_FISCAL_GATE);
    const entity = await db.accounting_entities.findFirst({ where: {
      id: expectedEntity, organization_id: organizationId, is_active: true,
      store_id: organization.fiscal_scope === 'STORE' ? storeId : null,
      scope: organization.fiscal_scope, fiscal_scope: organization.fiscal_scope,
    }, include: {
      organization: { include: { organization_settings: true } },
      store: { include: { store_settings: true } },
    } });
    const dian = await db.dian_configurations.findFirst({ where: {
      organization_id: organizationId, accounting_entity_id: expectedEntity,
      configuration_type: 'invoicing', environment: 'production', enablement_status: 'enabled',
      store_id: organization.fiscal_scope === 'STORE' ? storeId : null,
    }, select: { nit: true, name: true } });
    if (!entity || !dian) throw new VendixHttpException(ErrorCodes.EMAIL_RECEPTION_FISCAL_GATE);
    let access: Awaited<ReturnType<SubscriptionAccessService['canUseModule']>>;
    try { access = await this.subscriptions.canUseModule(storeId, 'received_documents'); }
    catch { throw new ServiceUnavailableException('No fue posible consultar la suscripción. Intenta nuevamente.'); }
    // Resolver outages are technical retries, not a durable business rejection of this email.
    if (access.reason === 'SUBSCRIPTION_INTERNAL_ERROR' || (access.allowed && !access.has_record)) {
      throw new ServiceUnavailableException('No fue posible consultar la suscripción. Intenta nuevamente.');
    }
    if (!access.allowed || !access.has_record) throw new VendixHttpException(ErrorCodes.EMAIL_RECEPTION_SUBSCRIPTION_BLOCKED);
    const settings = organization.fiscal_scope === 'STORE' ? entity.store?.store_settings?.settings : entity.organization.organization_settings?.settings;
    const fiscalData = this.fiscalData(settings);
    const identity = tryResolveTenantFiscalIdentity({ nit: dian.nit, config_name: dian.name, fiscal_data: fiscalData, entity, organization: entity.organization }).identity;
    const type = typeof fiscalData?.nit_type === 'string' ? fiscalData.nit_type : organization.fiscal_scope === 'STORE' ? store.nit_type : entity.organization.document_type;
    identity.nit_type = type ?? identity.nit_type ?? 'NIT';
    if (!identity.nit) throw new VendixHttpException(ErrorCodes.EMAIL_RECEPTION_FISCAL_GATE);
    return { fiscal_scope: organization.fiscal_scope, fiscal_identity: identity };
  }

  private async mutate(ctx: ReceivedDocumentsReadContext, expectedVersion: number, patch: Prisma.document_reception_email_inboxesUpdateManyMutationInput, rotated: boolean) {
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new VendixHttpException(ErrorCodes.SYS_VALIDATION_001);
    return this.prisma.$transaction(async (tx) => {
      // The transport registrar uses this same lock to fence acceptance against rotation.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`email-inbox:${ctx.organization_id}:${ctx.store_id}`}))`;
      const current = await tx.document_reception_email_inboxes.findFirst({ where: { organization_id: ctx.organization_id, store_id: ctx.store_id! } });
      if (!current) throw new VendixHttpException(ErrorCodes.EMAIL_RECEPTION_NOT_FOUND);
      this.assertBinding(current, ctx.accounting_entity_id);
      const changed = await tx.document_reception_email_inboxes.updateMany({
        where: { id: current.id, organization_id: ctx.organization_id, store_id: ctx.store_id!, accounting_entity_id: current.accounting_entity_id, version: expectedVersion },
        data: { ...patch, version: { increment: 1 }, updated_by: ctx.actor_id! },
      });
      if (changed.count !== 1) throw new VendixHttpException(ErrorCodes.EMAIL_RECEPTION_VERSION_CONFLICT);
      if (rotated) await tx.document_reception_email_messages.updateMany({ where: {
        inbox_id: current.id, organization_id: ctx.organization_id, store_id: ctx.store_id!,
      }, data: { gmail_code_encrypted: null, gmail_code_expires_at: null, gmail_challenge_alias: null } });
      const fresh = await tx.document_reception_email_inboxes.findFirst({ where: { id: current.id, organization_id: ctx.organization_id, store_id: ctx.store_id! } });
      if (!fresh) throw new VendixHttpException(ErrorCodes.EMAIL_RECEPTION_NOT_FOUND);
      await this.audit(tx, ctx, fresh, 'UPDATE', rotated);
      return this.toConfiguration(fresh);
    });
  }

  private async audit(tx: Prisma.TransactionClient, ctx: ReceivedDocumentsReadContext, inbox: Inbox, action: 'CREATE' | 'UPDATE', rotated: boolean) {
    await tx.audit_logs.create({ data: {
      user_id: ctx.actor_id!, organization_id: ctx.organization_id, store_id: ctx.store_id!,
      action, resource: 'document_reception_email_inboxes', resource_id: inbox.id,
      new_values: { version: inbox.version, enabled: inbox.enabled, policy_version: inbox.policy_version },
      metadata: { address_rotated: rotated },
    } });
  }

  private scopeWhere(ctx: ReadScope) {
    return { organization_id: ctx.organization_id, accounting_entity_id: ctx.accounting_entity_id!, ...(ctx.store_id != null ? { store_id: ctx.store_id } : {}) };
  }

  private assertStore(ctx: ReceivedDocumentsReadContext): void {
    if (ctx.is_organization || !Number.isSafeInteger(ctx.store_id) || ctx.store_id! < 1) throw new VendixHttpException(ErrorCodes.SYS_FORBIDDEN_001);
  }

  private assertActor(ctx: ReceivedDocumentsReadContext): void {
    this.assertStore(ctx);
    if (!Number.isSafeInteger(ctx.actor_id) || ctx.actor_id! < 1) throw new VendixHttpException(ErrorCodes.SYS_FORBIDDEN_001);
  }

  private assertBinding(inbox: Inbox, entityId: number | null): void {
    if (entityId != null && inbox.accounting_entity_id !== entityId) throw new VendixHttpException(ErrorCodes.EMAIL_RECEPTION_FISCAL_GATE);
  }

  private deliveryConfiguration() {
    const environment = this.config.get<string>('EMAIL_RECEPTION_ENVIRONMENT', 'staging');
    if (environment !== 'production' && environment !== 'staging') throw new VendixHttpException(ErrorCodes.EMAIL_RECEPTION_UNAVAILABLE);
    const domain = this.config.get<string>('EMAIL_RECEPTION_DOMAIN', APPROVED_DOMAINS[environment]);
    if (domain !== APPROVED_DOMAINS[environment]) throw new VendixHttpException(ErrorCodes.EMAIL_RECEPTION_UNAVAILABLE);
    return { environment, domain };
  }

  private policyVersion(): string { return this.config.get<string>('EMAIL_RECEPTION_POLICY_VERSION', '2026-10-13-v1'); }
  private newLocalPart(): string { return `facturas-${randomBytes(16).toString('hex')}`; }
  private safeReason(value: string | null): DocumentEmailReasonCode | null { return DOCUMENT_EMAIL_REASON_CODES.includes(value as DocumentEmailReasonCode) ? value as DocumentEmailReasonCode : null; }
  private fiscalData(settings: Prisma.JsonValue | undefined): Record<string, unknown> | null {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null;
    const data = settings.fiscal_data;
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  }
  private toConfiguration(inbox: Inbox | null): DocumentEmailConfiguration {
    return { configured: !!inbox, address: inbox ? `${inbox.local_part}@${inbox.domain}` : null,
      version: inbox?.version ?? null, enabled: inbox?.enabled ?? false, policy_version: this.policyVersion() };
  }
}
