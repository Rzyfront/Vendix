import { Injectable } from '@nestjs/common';
import {
  WORKFLOW_ACTION_CATALOG,
  WORKFLOW_CONNECTOR_CATALOG,
  WorkflowActionInputSpec,
  WorkflowConnectorKey,
  WorkflowVendixActionName,
} from '@common/workflows/contract';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { EmailService } from '../../../../email/email.service';
import { MessagingService } from '../../../../messaging/messaging.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { TestWhatsappConnectorDto } from './connectors.dto';
import {
  ConnectorInputError,
  NO_WHATSAPP_CHANNEL_MESSAGE,
  WHATSAPP_CHANNEL_WHERE,
  buildEmailHtml,
  normalizePhone,
  parseTemplateLanguage,
  parseTemplateName,
  parseTemplateParams,
} from './connector-delivery';

export type ConnectorState = 'connected' | 'not_connected' | 'available';

export interface ConnectorStatus {
  state: ConnectorState;
  /** One line for the card: what is connected. */
  summary: string;
  /** What is missing to connect it (`null` when nothing is). */
  missing: string | null;
  details: Record<string, string | number | null>;
}

export interface ConnectorActionView {
  name: string;
  label: string;
  permission: string;
  inputs: Array<{
    key: string;
    label: string;
    type: string;
    required: boolean;
    values: readonly string[] | null;
    min: number | null;
    max: number | null;
  }>;
}

export interface ConnectorView {
  key: WorkflowConnectorKey;
  label: string;
  description: string;
  actions: ConnectorActionView[];
  triggers: string[];
  testable: boolean;
  status: ConnectorStatus;
}

export interface ConnectorTestResult {
  ok: boolean;
  /** `true` when the server runs in a mode that does not really deliver. */
  simulated: boolean;
  message: string;
  checks?: Array<{ key: string; ok: boolean; message: string }>;
}

/** Connectors whose "Probar" runs here; the rest are tested from their flow. */
const TESTABLE: ReadonlySet<WorkflowConnectorKey> = new Set(['email_out', 'whatsapp', 'dian']);

const DAY_MS = 86_400_000;

/**
 * Connector registry API (P3.3, R6). The catalog is the contract's
 * `WORKFLOW_CONNECTOR_CATALOG`; this service adds the REAL connection status
 * of the requesting store and the connectors' tests. Everything is scoped to
 * the store of the request context.
 */
@Injectable()
export class WorkflowConnectorsService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly email: EmailService,
    private readonly messaging: MessagingService,
  ) {}

  async list(): Promise<ConnectorView[]> {
    const keys = Object.keys(WORKFLOW_CONNECTOR_CATALOG) as WorkflowConnectorKey[];
    return Promise.all(
      keys.map(async (key) => {
        const spec = WORKFLOW_CONNECTOR_CATALOG[key];
        return {
          key,
          label: spec.label,
          description: spec.description,
          actions: spec.actions.map((name) => this.actionView(name)),
          triggers: [...spec.triggers],
          testable: TESTABLE.has(key),
          status: await this.status(key),
        };
      }),
    );
  }

  async test(
    keyRaw: string,
    dto?: TestWhatsappConnectorDto,
  ): Promise<ConnectorTestResult> {
    const key = this.requireKey(keyRaw);
    switch (key) {
      case 'email_out':
        return this.testEmail();
      case 'whatsapp':
        return this.testWhatsapp(dto);
      case 'dian': {
        const report = await this.dianReport();
        return {
          ok: report.ok,
          simulated: false,
          message: report.ok
            ? 'La facturación electrónica está lista para emitir.'
            : `Falta: ${report.checks.filter((c) => !c.ok).map((c) => c.message).join(' ')}`,
          checks: report.checks,
        };
      }
      default:
        throw new VendixHttpException(ErrorCodes.WORKFLOW_CONNECTOR_NOT_TESTABLE);
    }
  }

  private requireKey(raw: string): WorkflowConnectorKey {
    if (!Object.prototype.hasOwnProperty.call(WORKFLOW_CONNECTOR_CATALOG, raw)) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_CONNECTOR_NOT_FOUND);
    }
    return raw as WorkflowConnectorKey;
  }

  private actionView(name: WorkflowVendixActionName): ConnectorActionView {
    const action = WORKFLOW_ACTION_CATALOG[name];
    return {
      name,
      label: action.label,
      permission: action.permission,
      inputs: Object.entries(action.inputs as Record<string, WorkflowActionInputSpec>).map(
        ([key, input]) => ({
          key,
          label: input.label,
          type: input.type,
          required: input.required === true,
          values: input.values ?? null,
          min: input.min ?? null,
          max: input.max ?? null,
        }),
      ),
    };
  }

  // ---- status per connector (read-only) ----

  private async status(key: WorkflowConnectorKey): Promise<ConnectorStatus> {
    switch (key) {
      case 'http':
        return this.httpStatus();
      case 'inbound_webhook':
        return this.inboundWebhookStatus();
      case 'email_out':
        return this.emailOutStatus();
      case 'email_in':
        return this.emailInStatus();
      case 'whatsapp':
        return this.whatsappStatus();
      case 'dian':
        return this.dianStatus();
    }
  }

  private async httpStatus(): Promise<ConnectorStatus> {
    const secrets = await this.prisma.workflow_secrets.count();
    return secrets > 0
      ? {
          state: 'connected',
          summary: `${secrets} secreto(s) guardado(s)`,
          missing: null,
          details: { secrets },
        }
      : {
          state: 'available',
          summary: 'Disponible para llamar servicios públicos',
          missing: 'Guarda un secreto en Integraciones si el servicio pide una clave.',
          details: { secrets: 0 },
        };
  }

  private async inboundWebhookStatus(): Promise<ConnectorStatus> {
    const flows = await this.prisma.workflow_inbound_hooks.count({ where: { is_active: true } });
    return flows > 0
      ? {
          state: 'connected',
          summary: `${flows} flujo(s) con webhook activo`,
          missing: null,
          details: { flows },
        }
      : {
          state: 'not_connected',
          summary: 'Ningún flujo recibe llamadas todavía',
          missing: 'Activa el webhook de entrada en las Integraciones de un flujo publicado.',
          details: { flows: 0 },
        };
  }

  private emailOutStatus(): ConnectorStatus {
    if (this.email.isConfigured()) {
      return {
        state: 'available',
        summary: 'Disponible: Vendix envía el correo por ti',
        missing: null,
        details: { simulated: this.email.getProviderName() === 'console' ? 1 : 0 },
      };
    }
    return {
      state: 'not_connected',
      summary: 'El envío de correo de la plataforma no está configurado',
      missing: 'Contacta a soporte de Vendix: falta configurar el proveedor de correo.',
      details: {},
    };
  }

  private async emailInStatus(): Promise<ConnectorStatus> {
    const [mailboxes, sample] = await Promise.all([
      this.prisma.workflow_mailboxes.count({ where: { is_active: true } }),
      this.prisma.workflow_mailboxes.findFirst({
        where: { is_active: true },
        orderBy: { id: 'asc' },
        select: { domain: true },
      }),
    ]);
    return mailboxes > 0
      ? {
          state: 'connected',
          summary: `${mailboxes} buzón(es) activo(s)`,
          missing: null,
          details: { mailboxes, domain: sample?.domain ?? null },
        }
      : {
          state: 'not_connected',
          summary: 'Ningún flujo tiene buzón',
          missing: 'Activa el buzón en un flujo con el disparador "Correo entrante".',
          details: { mailboxes: 0, domain: null },
        };
  }

  private async whatsappChannel() {
    return this.prisma.withoutScope().social_channels.findFirst({
      where: { store_id: this.storeId(), ...WHATSAPP_CHANNEL_WHERE },
      select: { id: true, display_phone_number: true },
    });
  }

  private async whatsappStatus(): Promise<ConnectorStatus> {
    const channel = await this.whatsappChannel();
    return channel
      ? {
          state: 'connected',
          summary: channel.display_phone_number
            ? `Canal conectado: ${channel.display_phone_number}`
            : 'Canal de WhatsApp conectado',
          missing: null,
          details: { phone: channel.display_phone_number ?? null },
        }
      : {
          state: 'not_connected',
          summary: 'La tienda no tiene WhatsApp conectado',
          missing: 'Conecta el canal de WhatsApp de la tienda.',
          details: { phone: null },
        };
  }

  private async dianStatus(): Promise<ConnectorStatus> {
    const report = await this.dianReport();
    return report.ok
      ? {
          state: 'connected',
          summary: 'Facturación electrónica habilitada',
          missing: null,
          details: report.details,
        }
      : {
          state: 'not_connected',
          summary: 'Facturación electrónica sin habilitar',
          missing: report.checks.filter((c) => !c.ok).map((c) => c.message).join(' '),
          details: report.details,
        };
  }

  /**
   * Read-only check of the store's electronic invoicing: same ownership rule as
   * the DIAN settings (organization-wide fiscal scope or the store's own).
   */
  private async dianReport(): Promise<{
    ok: boolean;
    checks: Array<{ key: string; ok: boolean; message: string }>;
    details: Record<string, string | number | null>;
  }> {
    const db = this.prisma.withoutScope();
    const storeId = this.storeId();
    const organizationId = this.organizationId();
    const organization = await db.organizations.findUnique({
      where: { id: organizationId },
      select: { fiscal_scope: true },
    });
    const config = await db.dian_configurations.findFirst({
      where:
        organization?.fiscal_scope === 'ORGANIZATION'
          ? { organization_id: organizationId, store_id: null, configuration_type: 'invoicing' }
          : { store_id: storeId, configuration_type: 'invoicing' },
      orderBy: [{ is_default: 'desc' }, { created_at: 'asc' }],
      select: {
        accounting_entity_id: true,
        enablement_status: true,
        environment: true,
        certificate_s3_key: true,
        certificate_kms_key_id: true,
        certificate_expiry: true,
      },
    });
    if (!config) {
      return {
        ok: false,
        checks: [
          {
            key: 'configuration',
            ok: false,
            message: 'La tienda no tiene configuración de facturación electrónica.',
          },
        ],
        details: { environment: null, certificate_expiry: null },
      };
    }

    const now = new Date();
    const hasCertificate = !!(config.certificate_s3_key || config.certificate_kms_key_id);
    const expiry = config.certificate_expiry;
    const resolution = await db.invoice_resolutions.findFirst({
      where: {
        organization_id: organizationId,
        accounting_entity_id: config.accounting_entity_id,
        document_type: 'sales_invoice',
        is_active: true,
        valid_from: { lte: now },
        valid_to: { gte: now },
      },
      select: { id: true, current_number: true, range_to: true },
    });
    const hasRange = !!resolution && resolution.current_number < resolution.range_to;

    const checks = [
      {
        key: 'enablement',
        ok: config.enablement_status === 'enabled',
        message: 'La DIAN aún no habilitó la facturación de la tienda.',
      },
      {
        key: 'certificate',
        ok: hasCertificate && (!expiry || expiry.getTime() > now.getTime()),
        message: !hasCertificate
          ? 'Falta cargar el certificado digital.'
          : 'El certificado digital está vencido.',
      },
      {
        key: 'resolution',
        ok: hasRange,
        message: resolution
          ? 'La resolución de facturación no tiene consecutivos disponibles.'
          : 'Falta una resolución de facturación vigente.',
      },
    ];
    const daysLeft = expiry ? Math.floor((expiry.getTime() - now.getTime()) / DAY_MS) : null;
    return {
      ok: checks.every((c) => c.ok),
      checks,
      details: { environment: config.environment, certificate_days_left: daysLeft },
    };
  }

  // ---- tests ----

  private async testEmail(): Promise<ConnectorTestResult> {
    const userId = RequestContextService.getUserId();
    const user = userId
      ? await this.prisma.withoutScope().users.findFirst({
          where: { id: userId },
          select: { email: true },
        })
      : null;
    if (!user?.email) {
      return {
        ok: false,
        simulated: false,
        message: 'Tu usuario no tiene un correo para recibir la prueba.',
      };
    }
    const store = await this.prisma.withoutScope().stores.findFirst({
      where: { id: this.storeId() },
      select: { name: true },
    });
    const body =
      'Este es un correo de prueba del conector de correo de Flujos.\n\nSi lo lees, tus flujos ya pueden enviar correos.';
    const result = await this.email.sendEmail(
      user.email,
      'Prueba del conector de correo de Flujos',
      buildEmailHtml(store?.name ?? 'Vendix', body),
      body,
    );
    const simulated = this.email.getProviderName() === 'console';
    if (!result.success) {
      return {
        ok: false,
        simulated,
        message: `El proveedor rechazó el envío: ${result.error ?? 'error desconocido'}.`,
      };
    }
    return {
      ok: true,
      simulated,
      message: simulated
        ? `Modo de pruebas del servidor: el correo a ${user.email} se registró pero no salió realmente.`
        : `Correo de prueba enviado a ${user.email}.`,
    };
  }

  private async testWhatsapp(dto?: TestWhatsappConnectorDto): Promise<ConnectorTestResult> {
    if (!dto?.to || !dto.template) {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        'Indica el teléfono y la plantilla para la prueba.',
      );
    }
    let input: { to: string; name: string; language: string; variables: string[] };
    try {
      input = {
        to: normalizePhone(dto.to),
        name: parseTemplateName(dto.template),
        language: parseTemplateLanguage(dto.language),
        variables: parseTemplateParams(dto.params),
      };
    } catch (e) {
      if (e instanceof ConnectorInputError) {
        throw new VendixHttpException(ErrorCodes.SYS_VALIDATION_001, e.message);
      }
      throw e;
    }
    const channel = await this.whatsappChannel();
    if (!channel) {
      return { ok: false, simulated: false, message: NO_WHATSAPP_CHANNEL_MESSAGE };
    }
    const simulated = this.messaging.isDryRun();
    const result = await this.messaging.sendTemplate({
      store_id: this.storeId(),
      to: input.to,
      template: { name: input.name, language: input.language, variables: input.variables },
      idempotency_key: `connector-test-${this.storeId()}-${Date.now()}`,
    });
    if (result.status !== 'sent') {
      return {
        ok: false,
        simulated,
        message: `WhatsApp rechazó el envío (${result.error_code ?? 'UNKNOWN'}): ${result.error_message ?? 'sin detalle'}.`,
      };
    }
    return {
      ok: true,
      simulated,
      message: simulated
        ? 'Modo de pruebas del servidor: el mensaje se registró pero no salió realmente.'
        : `Plantilla enviada a ${input.to}.`,
    };
  }

  private storeId(): number {
    const id = RequestContextService.getStoreId();
    if (!id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    return id;
  }

  private organizationId(): number {
    const id = RequestContextService.getOrganizationId();
    if (!id) throw new VendixHttpException(ErrorCodes.ORG_CONTEXT_001);
    return id;
  }
}
