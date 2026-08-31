import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import {
  dianAmount,
  dianLineExtensionTotal,
} from '../../../store/invoicing/utils/dian-money.util';
import { assertTechnicalKeyShape } from '../../../store/invoicing/utils/technical-key.util';
// Mismas funciones que el generador de numeración de tiendas, sin copia local:
// la forma de una ClTec no puede tener dos definiciones, o el carril que valida
// con la laxa emite lo que el otro rechaza.
import {
  isWellFormedTechnicalKey,
  normalizeTechnicalKey,
  TECHNICAL_KEY_LENGTHS,
  TECHNICAL_KEY_LENGTHS_LABEL,
} from '../../../store/invoicing/fiscal-document-requirements';
import { createHash } from 'crypto';

import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { EncryptionService } from '../../../../common/services/encryption.service';
import { TechnicalKeyVaultService } from '../../../../common/services/technical-key-vault.service';
import { S3Service } from '../../../../common/services/s3.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import {
  PLATFORM_FISCAL_SETTINGS_KEY,
  PLATFORM_TIMEZONE,
} from '../../../../common/constants/platform-fiscal.constants';
import { normalizeNit } from '../../../../common/utils/nit.util';
import {
  normalizeAcquirerTaxRegime,
  normalizePersonType,
} from '../../../../common/utils/dian-party-vocabulary.util';
import {
  PlatformOrgService,
  PlatformOrgContext,
} from '../../../../common/services/platform-org.service';
import {
  localDateString,
  localTimeString,
} from '../../../../common/utils/store-timezone.util';
import {
  resolveInvoiceControl,
  InvoiceControlSource,
} from '../../../../common/helpers/invoice-control.helper';
import { DianDirectProvider } from '../../../store/invoicing/providers/dian-direct/dian-direct.provider';
import {
  DianSoapClient,
  WsSecurityCredentials,
} from '../../../store/invoicing/providers/dian-direct/dian-soap.client';
import { DianXmlSignerService } from '../../../store/invoicing/providers/dian-direct/dian-xml-signer.service';
import {
  ProviderInvoiceData,
  ProviderInvoiceTax,
  ProviderResponse,
} from '../../../store/invoicing/providers/invoice-provider.interface';
import { CreatePlatformInvoiceDto } from './dto/subscription-fiscal.dto';
import { ManualCertificateIssuerAdapter } from '../../../store/invoicing/dian-config/certificates/manual-certificate-issuer.adapter';
import { DianTestService } from '../../../store/invoicing/dian-config/dian-test.service';
import { DianConfigService } from '../../../store/invoicing/dian-config/dian-config.service';
// Mismo servicio que el riel de tiendas, sin variantes: la consulta a
// `GetNumberingRange` y el cruce contra `invoice_resolutions` tienen que dar el
// MISMO veredicto para la plataforma que para un tenant, `technical_key_matches`
// incluido.
import {
  ApplyNumberingRangesResult,
  DianNumberingRangeService,
  NumberingRangeReport,
} from '../../../store/invoicing/dian-config/dian-numbering-range.service';
import { ApplyNumberingRangesDto } from '../../../store/invoicing/dian-config/dto/apply-numbering-range.dto';
// LOS DOS PREVALIDADORES DEL CARRIL DE TIENDAS, sin copia ni variante.
//
// Ambos son `@Injectable()` PUROS —no tocan Prisma, no conocen la tienda— así
// que la plataforma los usa tal cual. Tener reglas propias acá es exactamente
// cómo se llega a que un carril emita lo que el otro rechaza, y el 17/08/2026
// costó el rechazo de la primera factura de suscripción: el carril de plataforma
// no tenía ninguna de las 48 reglas aritméticas ni las 40 de identidad.
import {
  CustomerFiscalIdentityInput,
  CustomerFiscalIdentityValidator,
} from '../../../store/invoicing/validators/customer-fiscal-identity.validator';
import {
  FiscalDocumentComputedTotals,
  FiscalDocumentValidationInput,
  FiscalDocumentValidator,
} from '../../../store/invoicing/validators/fiscal-document.validator';
import { resolveTestSetWait } from '../../../store/invoicing/dian-config/test-set-wait.util';
import {
  buildNotePhaseView,
  canWriteEnablementStatus,
} from '../../../store/invoicing/dian-config/note-phase-gate.util';
import { assertPlausibleFiscalDate } from '../../../../common/utils/fiscal-date.util';
import { buildTestSetCompositionView } from '../../../store/invoicing/dian-config/dian-test-set-composition';
import {
  FiscalProductionReadinessService,
  ProductionReadinessCheck,
} from '../../../store/invoicing/providers/fiscal-production-readiness.service';
// CONTRATO FISCAL DE LA FACTURA DE SUSCRIPCIÓN — la forma fiscal del documento
// (descripción, código de ítem, unidad, forma y medio de pago, leyenda de
// exclusión del IVA y descuento de documento) vive en UN solo módulo compartido
// con el riel de tienda. Acá se CONSUME; escribir cualquiera de esos literales de
// nuevo es cómo la factura terminó con descripciones en inglés y sin leyenda.
import {
  InvoiceLineItem,
  SubscriptionInvoiceMetadata,
} from '../../../store/subscriptions/types/billing.types';
import { PlatformInvoicingPersistenceService } from './platform-invoicing-persistence.service';
import {
  buildSubscriptionItemCode,
  buildSubscriptionInvoiceNotes,
  buildSubscriptionLineDescription,
  dianUnitCodeForBillingCycle,
  resolveSubscriptionDocumentDiscount,
  resolveSubscriptionPaymentForm,
  resolveSubscriptionPaymentMeans,
} from '../../../store/subscriptions/types/subscription-invoice-fiscal.contract';
// MISMA cascada de dirección del adquiriente que usa la emisión de tienda. No se
// reimplementa: una segunda política de «cuál dirección declaro» se desincroniza
// de la del emisor, y la forma de desincronizarse es la peor —elegir acá un
// candidato que el builder rechaza después, ya dentro del camino que gasta el
// consecutivo—.
import {
  AcquirerAddressCandidate,
  ResolvedAcquirerAddress,
  resolveAcquirerAddress,
} from '../../../store/invoicing/providers/dian-direct/acquirer-address.resolver';
import {
  DianAddressFields,
  UblDocumentLine,
} from '../../../store/invoicing/providers/dian-direct/xml/ubl-common.builder';

/**
 * A platform habilitación check. Same fields as the tenant
 * `ProductionReadinessCheck` so both surfaces render from ONE contract, plus
 * `issued_by_dian` kept as a derived mirror of `blocked_by` for the superadmin UI
 * that predates the unification.
 */
export interface PlatformHabilitationCheck {
  key: string;
  label: string;
  satisfied: boolean;
  action: string;
  /** Derived: `blocked_by === 'dian'`. */
  issued_by_dian: boolean;
  severity: 'blocking' | 'warning';
  owner: 'tenant' | 'platform';
  blocked_by: 'vendix' | 'dian';
  days_remaining?: number;
  percent_remaining?: number;
}
import {
  CreatePlatformResolutionDto,
  ListPlatformResolutionsQueryDto,
  PLATFORM_RESOLUTION_DOCUMENT_TYPES,
  PlatformResolutionDocumentType,
  SubscriptionFiscalEnvironment,
  SubscriptionFiscalQueryDto,
  UpdatePlatformResolutionDto,
  UpsertSubscriptionFiscalConfigDto,
} from './dto/subscription-fiscal.dto';

const SETTINGS_KEY = PLATFORM_FISCAL_SETTINGS_KEY;
/**
 * The vendor documento-soporte switch lives in its own `platform_settings` row
 * and can also point at a resolution. Destructive resolution changes must check
 * both, otherwise deleting a resolution would break documento soporte with no
 * warning. Kept local to avoid importing the whole vendor-support service just
 * for a string.
 */
const VENDOR_SUPPORT_SETTINGS_KEY = 'vendor_support_fiscal';
const PRODUCTION_TEST_FRESHNESS_MS = 60 * 60 * 1000;
const DECIMAL_ZERO = new Prisma.Decimal(0);
/**
 * Respaldo cuando `organizations.is_platform` no está sembrado todavía. NO es la
 * fuente de verdad: el id se deriva vía `PlatformOrgService`, que lee la fila
 * marcada como plataforma. Dejarlo como literal en cada `where` era otro
 * resolutor paralelo, y dos resolutores del mismo hecho terminan discrepando.
 */
const PLATFORM_ORGANIZATION_ID_FALLBACK = 1;
/**
 * Cuántas direcciones de la organización entran a la cascada del adquiriente.
 *
 * Mismo tope que usa la lectura del perfil de checkout: la cascada necesita
 * VARIAS candidatas para poder preferir la fiscal, y un tenant con decenas de
 * direcciones de envío no debe convertir la emisión en una consulta pesada.
 */
const ACQUIRER_ADDRESS_CANDIDATE_LIMIT = 10;

interface SubscriptionFiscalSettings {
  is_enabled: boolean;
  auto_issue: boolean;
  environment: SubscriptionFiscalEnvironment;
  platform_organization_id: number | null;
  accounting_entity_id: number | null;
  dian_configuration_id: number | null;
  invoice_resolution_id: number | null;
  last_tested_at: string | null;
  last_test_result: {
    ok: boolean;
    message?: string;
    dian_status?: string;
    environment: SubscriptionFiscalEnvironment;
    config_fingerprint: string;
    tested_at: string;
  } | null;
  updated_by_user_id?: number | null;
  updated_at?: string | null;
}

interface SubscriptionInvoiceForFiscal {
  id: number;
  invoice_number: string;
  state: string;
  issued_at: Date | null;
  due_at: Date;
  period_start: Date;
  period_end: Date;
  subtotal: Prisma.Decimal;
  tax_amount: Prisma.Decimal;
  total: Prisma.Decimal;
  currency: string;
  line_items: Prisma.JsonValue;
  /**
   * `subscription_invoices.metadata`. Es JSON sin tipar en la base: se lee SOLO
   * por los resolvedores del contrato fiscal (`resolveSubscriptionDocumentDiscount`),
   * nunca indexando la llave a mano. Ahí vive el descuento de documento —el
   * crédito por cambio a plan inferior—, que antes viajaba como línea negativa.
   */
  metadata: Prisma.JsonValue;
  store_id: number;
  store_subscription_id: number;
  payments: Array<{
    id: number;
    state: string;
    payment_method: string | null;
    paid_at: Date | null;
    created_at: Date;
  }>;
  store_subscription: {
    plan: {
      name: string | null;
      code: string | null;
      /**
       * Califica la CANTIDAD de la línea: el ciclo decide la unidad de medida
       * DIAN (`LUN` mes / `ANA` año). Sin él la línea declara «1 unidad» de un
       * servicio que se prestó por un mes.
       */
      billing_cycle: string | null;
    } | null;
    store: {
      id: number;
      name: string;
      organizations: {
        id: number;
        name: string;
        legal_name: string | null;
        tax_id: string | null;
        email: string | null;
        document_type: string | null;
        verification_digit: string | null;
        person_type: string | null;
        tax_regime: string | null;
        fiscal_responsibilities: string[];
        /**
         * CANDIDATAS a dirección del adquiriente, no la dirección ya elegida.
         *
         * Antes se leía UNA sola fila con `where: { type: 'billing' }`, sin
         * respaldo: un tenant que guardó su domicilio fiscal con tipo `legal`
         * —o con cualquier otro— emitía la factura SIN dirección de adquiriente,
         * aunque el dato existiera en la base.
         *
         * Quién gana lo decide `resolveAcquirerAddress` (la MISMA cascada de la
         * emisión de tienda), y para eso necesita `type`: es lo único que separa
         * el escalón fiscal (`billing` / `legal`) del resto.
         */
        addresses: Array<{
          address_line1: string;
          address_line2: string | null;
          city: string;
          state_province: string | null;
          country_code: string;
          postal_code: string | null;
          municipality_code: string | null;
          is_primary: boolean;
          type: string;
        }>;
      } | null;
    };
  };
}

/**
 * Fila de `invoice_resolutions` que la emisión de la plataforma necesita.
 *
 * Se declara sobre `InvoiceControlSource` para que el resolvedor único la acepte
 * tal cual, y se le añade lo que el XML pide aparte del bloque de control: la
 * clave técnica (`ClTec`, que alimenta el CUFE) y el número de resolución.
 *
 * `current_number` NO está en `InvoiceControlSource` porque aquel helper solo
 * valida la coherencia del rango y de la vigencia — el cursor no le hace falta.
 * Acá sí: lo leen el suelo del sondeo (`evaluateEmitReadiness`) y el informe de
 * `emit-readiness`, ambos para anticipar qué número se asignaría sin escribirlo.
 * La fila de Prisma se carga entera (sin `select`), así que el campo siempre
 * viene; declararlo es lo que hace que `tsc` lo vea, porque swc no typechequea
 * y el watch de Docker no lo habría delatado.
 */
type PlatformInvoiceResolution = InvoiceControlSource & {
  id: number;
  technical_key: string | null;
  document_type: string;
  current_number: number;
};

/**
 * Un motivo por el que la factura no puede emitirse todavía, o un aviso de que
 * se emitiría diciendo menos de lo que debería.
 *
 * `source` existe para que quien lea el informe sepa DÓNDE se arregla sin tener
 * que reconocer el código: `completeness` y `identity` mandan a los datos
 * fiscales de la organización; `document` manda a la factura o a la resolución.
 */
export interface SubscriptionEmitBlocker {
  source: 'completeness' | 'identity' | 'document';
  code: string;
  field: string;
  problem: string;
  fix: string;
  details?: Record<string, unknown>;
  /** Regla del Anexo Técnico que este hallazgo anticipa, si la hay. */
  dian_rule?: string | null;
}

/**
 * Veredicto sobre si una factura de suscripción puede emitirse, SIN emitirla.
 *
 * `computed` son los importes que el XML va a declarar, recomputados con las
 * mismas funciones que los escriben. Sin ellos, un descuadre obliga a
 * reconstruir a mano la aritmética del emisor.
 */
export interface SubscriptionEmitReadiness {
  emittable: boolean;
  subscription_invoice_id: number;
  /**
   * El consecutivo que se asignaría. Es un SONDEO: leerlo no lo consume, y esa
   * es la diferencia entre este informe y emitir para ver qué pasa.
   */
  document_number_preview: string;
  resolution_id: number;
  blockers: SubscriptionEmitBlocker[];
  warnings: SubscriptionEmitBlocker[];
  computed: FiscalDocumentComputedTotals;
}

@Injectable()
export class SubscriptionFiscalService {
  private readonly logger = new Logger(SubscriptionFiscalService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly encryption: EncryptionService,
    private readonly s3Service: S3Service,
    private readonly dianProvider: DianDirectProvider,
    private readonly dianSoapClient: DianSoapClient,
    private readonly dianXmlSigner: DianXmlSignerService,
    private readonly certificateAdapter: ManualCertificateIssuerAdapter,
    private readonly dianTestService: DianTestService,
    private readonly platformOrg: PlatformOrgService,
    // Reused so the platform checklist raises the SAME early alerts, with the
    // same thresholds and copy, as the tenant one.
    private readonly readiness: FiscalProductionReadinessService,
    // Reutilizado tal cual bajo contexto de plataforma, igual que
    // `DianTestService`: el reporte de readiness y la guarda de promoción tienen
    // que ser LOS MISMOS que ve un tenant.
    private readonly dianConfigService: DianConfigService,
    // Mismo criterio: la consulta de rangos autorizados y la sincronización de la
    // ClTec son las de tienda, ejecutadas bajo contexto de plataforma. Sin esto la
    // resolución y la clave técnica de la plataforma se teclean a mano, que es la
    // causa raíz del FAD06 que este servicio existe para cerrar.
    private readonly dianNumberingRangeService: DianNumberingRangeService,
    // La ClTec se persiste en TRES columnas (plana, cifrada y huella) y
    // `reveal()` prefiere la cifrada. Escribir sólo la plana desde acá dejaría
    // la cifrada ANTERIOR al mando: el super admin vería su corrección
    // guardada y el CUFE se seguiría hashando con la clave vieja. Llega por
    // `EncryptionModule`, que es @Global.
    private readonly technicalKeyVault: TechnicalKeyVaultService,
    // Los dos prevalidadores del carril de tiendas. Puros y sin estado: la única
    // razón de inyectarlos en vez de instanciarlos es que Nest los comparta con
    // el otro carril, para que actualizar una regla actualice los dos.
    private readonly identityValidator: CustomerFiscalIdentityValidator,
    private readonly documentValidator: FiscalDocumentValidator,
    // Para releer el snapshot del documento (kind='platform_invoice_snapshot')
    // tras la aceptación y emitir `invoice.accepted` con los totales e importes
    // que la DIAN acaba de firmar. LaDIAN ya aceptó: el evento es el contrato
    // que dispara el asiento contable automático contra el accounting_entity de
    // la plataforma, igual que el riel de tienda pero con `store_id` ausente.
    private readonly persistence: PlatformInvoicingPersistenceService,
    // Único bus de eventos de Nest. La factura de plataforma emite
    // `invoice.accepted` y `AccountingEventsListener` resuelve el subflujo
    // `invoicing` + las cuentas PUC; no usamos el `EventEmitter` de Node.
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async getStatus() {
    const settings = await this.getSettings();
    const config = settings.dian_configuration_id
      ? await this.prisma.withoutScope().dian_configurations.findUnique({
          where: { id: settings.dian_configuration_id },
        })
      : null;
    const resolution = settings.invoice_resolution_id
      ? await this.prisma.withoutScope().invoice_resolutions.findUnique({
          where: { id: settings.invoice_resolution_id },
        })
      : null;

    const [accepted, errors, pending] = await Promise.all([
      this.countTransmissions(['accepted']),
      this.countTransmissions(['error', 'rejected']),
      this.countTransmissions(['queued', 'retrying', 'submitted', 'signing', 'signed']),
    ]);

    return {
      settings,
      dian_config: config ? this.maskConfig(config) : null,
      resolution,
      stats: { accepted, errors, pending },
      suggested: await this.buildSuggestedConfig(),
      // Bounded reading of the habilitación batch, so the page shows the current
      // state on load instead of only after the superadmin presses a button.
      // Without it a queued batch is invisible and the habilitación looks hung.
      test_set: config
        ? {
            enablement_status: config.enablement_status,
            test_set_id: config.test_set_id,
            environment: config.environment,
            // SIN el `note_phase` crudo: lleva cada nota retenida ENTERA, con su
            // XML firmado. Este panel sondea el estado, así que un lote diferido
            // mandaba 20 documentos firmados al navegador en cada consulta —datos
            // que la UI no puede usar y que no deberían salir del servidor.
            //
            // El recuento y la razón van abajo, en la vista.
            last_test_result: this.stripNotePhase(config.last_test_result),
            // Generados ≠ transmitidos con el envío en dos fases: si las notas se
            // difieren se generan 50 y salen 30. Sin estos tres campos la UI decía
            // «50 documentos» sobre un lote del que salieron 30, y las notas
            // retenidas eran invisibles.
            note_phase: buildNotePhaseView(
              (config.last_test_result as Record<string, any> | null)
                ?.note_phase,
            ),
            // Sobre la prueba DURABLE, no sobre el último lote. Un reenvío
            // posterior sobrescribe `last_test_result`, así que este panel decía
            // «habilitación pendiente» sobre una config que la DIAN había
            // habilitado catorce horas antes. Ver `resolveTestSetProof`.
            wait: resolveTestSetWait(config),
            // Viaja al cliente porque la UI imprimía "50 documentos", la
            // composición de 2019, y con eso desinformaba sobre cuántos
            // consecutivos de la resolución consume cada envío.
            composition: buildTestSetCompositionView(config.operation_mode),
          }
        : null,
      habilitation_readiness: this.buildHabilitationReadiness(
        settings,
        config,
        resolution,
      ),
    };
  }

  /**
   * What is still missing before the platform can submit its habilitación set.
   *
   * The production-readiness report answers "can I go live?"; this answers the
   * earlier question "can I even start?". Without it a superadmin faces a page
   * whose only feedback is a 412 after pressing a button, with no way to see that
   * the blocker is, say, a `software_id` the DIAN has not issued yet — data no
   * amount of code can invent.
   */
  private buildHabilitationReadiness(
    settings: SubscriptionFiscalSettings,
    config: {
      software_id: string | null;
      software_pin_encrypted: string | null;
      test_set_id: string | null;
      certificate_s3_key: string | null;
      certificate_password_encrypted: string | null;
      certificate_expiry: Date | null;
      nit: string | null;
    } | null,
    resolution: {
      id: number;
      prefix: string | null;
      range_from: number;
      range_to: number;
      current_number: number;
    } | null,
  ): {
    ready: boolean;
    checks: PlatformHabilitationCheck[];
    /** Blocking, actionable now (Vendix operations can supply the value). */
    actionable: PlatformHabilitationCheck[];
    /** Blocking, waiting on the DIAN to issue or rule. */
    waiting_on_dian: PlatformHabilitationCheck[];
    /** Early alerts. Never affect `ready`. */
    warnings: PlatformHabilitationCheck[];
  } {
    // 'PENDING' is what the platform seed writes as a placeholder. Treating it as
    // present would make the checklist claim a software_id Vendix does not have.
    const placeholder = (value: string | null | undefined) =>
      !value || value.trim().toUpperCase() === 'PENDING';

    const certificateValid =
      !!config?.certificate_expiry &&
      config.certificate_expiry.getTime() > Date.now();

    const checks = [
      {
        key: 'settings_configured',
        label: 'Identidad fiscal de la plataforma registrada',
        satisfied:
          !!settings.platform_organization_id && !!settings.accounting_entity_id,
        action:
          'Guarda la configuración con la organización plataforma y su entidad contable.',
        issued_by_dian: false,
      },
      {
        key: 'dian_configuration',
        label: 'Configuración DIAN de facturación creada',
        satisfied: !!settings.dian_configuration_id && !!config,
        action: 'Guarda la configuración DIAN de la plataforma.',
        issued_by_dian: false,
      },
      {
        key: 'software_id',
        label: 'Software ID emitido por la DIAN',
        satisfied: !placeholder(config?.software_id),
        action:
          'Registra el Software ID que la DIAN entrega al inscribir el software de facturación.',
        issued_by_dian: true,
      },
      {
        key: 'software_pin',
        label: 'PIN del software guardado',
        satisfied: !!config?.software_pin_encrypted,
        action: 'Registra el PIN que definiste al inscribir el software en la DIAN.',
        issued_by_dian: true,
      },
      {
        key: 'test_set_id',
        label: 'Test Set ID de habilitación',
        satisfied: !placeholder(config?.test_set_id),
        action:
          'Registra el TestSetId que la DIAN asigna al solicitar el set de pruebas.',
        issued_by_dian: true,
      },
      {
        key: 'certificate',
        label: 'Certificado de firma digital cargado',
        satisfied: !!config?.certificate_s3_key,
        action: 'Sube el archivo .p12 del certificado de firma.',
        issued_by_dian: false,
      },
      {
        key: 'certificate_password',
        label: 'Contraseña del certificado guardada',
        satisfied: !!config?.certificate_password_encrypted,
        action: 'Vuelve a subir el certificado indicando su contraseña.',
        issued_by_dian: false,
      },
      {
        key: 'certificate_valid',
        label: 'Certificado vigente',
        satisfied: certificateValid,
        action:
          'El certificado está vencido o sin fecha de expiración: sube uno vigente.',
        issued_by_dian: false,
      },
      {
        key: 'invoice_resolution',
        label: 'Resolución de numeración asignada',
        satisfied: !!settings.invoice_resolution_id && !!resolution,
        action:
          'Crea la resolución de factura de venta y apúntala en la configuración.',
        issued_by_dian: false,
      },
      {
        key: 'resolution_cursor',
        label: 'Numeración dentro del rango autorizado',
        // A cursor below the floor emits numbers outside the authorized range and
        // the DIAN rejects every one of them, so it belongs in the checklist even
        // though nothing about it is "missing".
        satisfied:
          !resolution || resolution.current_number >= resolution.range_from - 1,
        action:
          'El consecutivo de la resolución quedó por debajo de su rango: se corrige al emitir, pero revísalo antes de enviar el set.',
        issued_by_dian: false,
      },
    ];

    // Same two early alerts the tenant checklist raises, from the same helpers:
    // a platform certificate 5 days from expiry or a platform range at 3% is the
    // identical outage, and duplicating the thresholds here is how the two
    // surfaces end up warning on different days.
    const warning_checks: PlatformHabilitationCheck[] = [
      this.toPlatformCheck(
        this.readiness.buildCertificateExpiryWarning(
          config?.certificate_expiry ?? null,
        ),
      ),
      ...(resolution
        ? [
            this.toPlatformCheck(
              this.readiness.buildResolutionRangeWarning(resolution),
            ),
          ]
        : []),
    ];

    const all_checks: PlatformHabilitationCheck[] = [
      ...checks.map((check) => ({
        ...check,
        severity: 'blocking' as const,
        owner: 'platform' as const,
        blocked_by: check.issued_by_dian
          ? ('dian' as const)
          : ('vendix' as const),
      })),
      ...warning_checks,
    ];

    const unsatisfied = all_checks.filter((c) => !c.satisfied);
    const blocking = unsatisfied.filter((c) => c.severity !== 'warning');

    return {
      // `ready` counts BLOCKING checks only: an expiring certificate still signs
      // today, so it must not stop the habilitación from being submitted.
      ready: blocking.length === 0,
      checks: all_checks,
      actionable: blocking.filter((c) => c.blocked_by !== 'dian'),
      waiting_on_dian: blocking.filter((c) => c.blocked_by === 'dian'),
      warnings: unsatisfied.filter((c) => c.severity === 'warning'),
    };
  }

  /**
   * Adapts a tenant-shaped `ProductionReadinessCheck` to the platform checklist.
   *
   * `issued_by_dian` is kept as a derived mirror of `blocked_by` so the existing
   * superadmin UI keeps compiling while it migrates to the unified field.
   */
  private toPlatformCheck(
    check: ProductionReadinessCheck,
  ): PlatformHabilitationCheck {
    const blocked_by = check.blocked_by ?? 'vendix';
    return {
      key: check.key,
      label: check.label,
      satisfied: check.satisfied,
      action: check.action,
      issued_by_dian: blocked_by === 'dian',
      severity: check.severity ?? 'blocking',
      owner: 'platform',
      blocked_by,
      days_remaining: check.days_remaining,
      percent_remaining: check.percent_remaining,
    };
  }

  /**
   * Identidad fiscal de la plataforma resuelta server-side, para prellenar el
   * formulario en vez de pedirle al superadmin que reteclee lo que Vendix ya
   * sabe. Cinco de los ocho campos del formulario son datos derivables; los
   * tres restantes (`software_id`, `software_pin`, `test_set_id`) los emite la
   * DIAN y no hay forma de inferirlos.
   *
   * Va en el backend y no en el front porque el superadmin no tiene contexto de
   * tenant: `PlatformOrgService` es el único que sabe cuál de todas las
   * organizaciones es Vendix.
   *
   * Best-effort por diseño: una plataforma a medio bootstrapear devuelve nulls,
   * nunca rompe la carga de la página.
   */
  /**
   * Entidad contable a la que se adscribe una resolución de plataforma.
   *
   * Precedencia: lo guardado en `platform_settings` primero; si aún no existe
   * esa fila, el contexto de plataforma, que resuelve la entidad contable activa
   * de la organización 1.
   *
   * El respaldo existe porque exigir `platform_settings` creaba un bloqueo
   * circular real: esa fila solo la escribe `PATCH /config`, que a su vez exige
   * `software_id` y `software_pin` — datos que **emite la DIAN**. Resultado: no
   * se podía registrar una resolución de numeración hasta tener credenciales de
   * software, cuando la entidad contable es un hecho propio de Vendix (qué
   * persona jurídica es dueña del NIT) y no depende de la DIAN en absoluto.
   */
  /**
   * The platform organization id, derived from `organizations.is_platform`.
   *
   * Falls back to the literal only when the platform row is not seeded yet, so a
   * fresh environment still boots instead of failing every fiscal read.
   */
  private async resolvePlatformOrganizationId(): Promise<number> {
    const resolved = await this.platformOrg.getPlatformOrganizationId();
    return resolved ?? PLATFORM_ORGANIZATION_ID_FALLBACK;
  }

  /**
   * The platform's identity ids, derived — never read from the settings row.
   *
   * Returns nulls instead of throwing so `getSettings()` stays readable on an
   * un-bootstrapped environment; the callers that need a real id go through
   * {@link resolvePlatformAccountingEntityId}, which does throw.
   */
  private async derivePlatformIdentity(): Promise<{
    platform_organization_id: number | null;
    accounting_entity_id: number | null;
  }> {
    try {
      const context = await this.platformOrg.getPlatformContext();
      return {
        platform_organization_id: context?.organization_id ?? null,
        accounting_entity_id: context?.accounting_entity_id ?? null,
      };
    } catch (err) {
      // getPlatformContext throws when the org exists but its fiscal entity is
      // missing or inconsistent with its fiscal_scope. That is worth surfacing
      // once, not on every read.
      this.logger.warn(
        `No se pudo derivar la identidad fiscal de plataforma: ${(err as Error).message}`,
      );
      return { platform_organization_id: null, accounting_entity_id: null };
    }
  }

  /**
   * The accounting entity every platform fiscal write must use.
   *
   * Derived, with no settings fallback: the stored value is a mirror of this one
   * (see {@link getSettings}) and preferring it is what let a STORE entity leak
   * into a platform whose scope only resolves the consolidated entity.
   */
  private async resolvePlatformAccountingEntityId(): Promise<number> {
    let platformContext: PlatformOrgContext | null = null;
    let failure: string | null = null;
    try {
      platformContext = await this.platformOrg.getPlatformContext();
    } catch (err) {
      failure = (err as Error).message;
      this.logger.warn(
        `No se pudo resolver la entidad contable de plataforma: ${failure}`,
      );
    }

    if (!platformContext?.accounting_entity_id) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_RESOLUTION_006,
        failure ??
          'La organización plataforma no tiene una entidad contable activa. Regístrala en Identidad fiscal antes de crear resoluciones de numeración.',
      );
    }
    return platformContext.accounting_entity_id;
  }

  private async buildSuggestedConfig(): Promise<{
    platform_organization_id: number | null;
    accounting_entity_id: number | null;
    name: string | null;
    nit: string | null;
    nit_dv: string | null;
  }> {
    const empty = {
      platform_organization_id: null,
      accounting_entity_id: null,
      name: null,
      nit: null,
      nit_dv: null,
    };

    let platformContext: PlatformOrgContext | null = null;
    try {
      platformContext = await this.platformOrg.getPlatformContext();
    } catch (err) {
      // getPlatformContext() lanza cuando la org existe pero no tiene entidad
      // contable activa. Es un estado real e informativo, pero degradar una
      // sugerencia no justifica tumbar el endpoint de estado.
      this.logger.warn(
        `No se pudo resolver el contexto de plataforma para sugerencias: ${(err as Error).message}`,
      );
      return empty;
    }
    if (!platformContext) return empty;

    const org = await this.prisma.withoutScope().organizations.findUnique({
      where: { id: platformContext.organization_id },
      select: { name: true, legal_name: true, tax_id: true },
    });
    if (!org) return empty;

    // Precedencia: columnas primero (canónicas tras la unificación de identidad
    // fiscal), `settings.fiscal_data` como respaldo para organizaciones que aún
    // no han vuelto a guardar su identidad desde entonces.
    const fiscalData = await this.readPlatformFiscalData(
      platformContext.organization_id,
    );

    const rawNit =
      org.tax_id?.trim() ||
      (typeof fiscalData?.tax_id === 'string' && fiscalData.tax_id.trim()) ||
      (typeof fiscalData?.nit === 'string' && fiscalData.nit.trim()) ||
      null;
    // `normalizeNit` y no `computeNitDv`: hay filas históricas donde `tax_id`
    // guarda el NIT con su DV pegado (`900123456-7`). Calcular el módulo 11
    // sobre esa cadena incluye el DV como dígito y devuelve un valor incorrecto.
    const { number: nit, dv: nitDv } = normalizeNit(rawNit);
    const name =
      org.legal_name?.trim() ||
      (typeof fiscalData?.legal_name === 'string' &&
        fiscalData.legal_name.trim()) ||
      org.name?.trim() ||
      null;

    return {
      platform_organization_id: platformContext.organization_id,
      accounting_entity_id: platformContext.accounting_entity_id,
      name,
      // El NIT se sugiere sin DV; el DV va en su propio campo. Derivado, nunca
      // leído: un DV almacenado que discrepe es por definición incorrecto.
      nit: nit || null,
      nit_dv: nit ? nitDv || null : null,
    };
  }

  private async readPlatformFiscalData(
    organization_id: number,
  ): Promise<Record<string, unknown> | null> {
    const row = await this.prisma
      .withoutScope()
      .organization_settings.findFirst({
        where: { organization_id },
        select: { settings: true },
      });
    const settings = (row?.settings ?? null) as Record<string, unknown> | null;
    const fiscalData = settings?.fiscal_data;
    return fiscalData && typeof fiscalData === 'object'
      ? (fiscalData as Record<string, unknown>)
      : null;
  }

  async upsertConfig(
    dto: UpsertSubscriptionFiscalConfigDto,
    userId: number | null,
  ) {
    const previous = await this.getSettings();
    // El DV es un checksum, no un dato: se deriva del NIT y se ignora lo que
    // haya llegado en el DTO. Un DV tecleado con typo no falla aquí — falla
    // después, al validar el certificado P12 contra `expected_dv`, con un error
    // que culpa al certificado en vez de al dígito.
    const { number: normalizedNit, dv: derivedDv } = normalizeNit(dto.nit);
    dto.nit = normalizedNit || dto.nit;
    dto.nit_dv = derivedDv || undefined;

    // La identidad de la plataforma se DERIVA. El DTO ya no la transporta: hay una
    // sola configuración de plataforma y una sola entidad fiscal, y pedirlas como
    // ids obligaba a acertar el valor que el cliente scopeado ya calcula solo.
    const platform_organization_id = await this.resolvePlatformOrganizationId();
    const accounting_entity_id = await this.resolvePlatformAccountingEntityId();

    await this.assertFiscalContext(platform_organization_id, accounting_entity_id);
    if (dto.invoice_resolution_id) {
      await this.assertResolution(dto.invoice_resolution_id, accounting_entity_id);
    }

    const existingConfig = await this.findPlatformInvoicingConfig({
      organization_id: platform_organization_id,
      nit: dto.nit,
      preferred_id:
        dto.dian_configuration_id ?? previous.dian_configuration_id ?? null,
    });

    if (!existingConfig && !dto.software_pin) {
      throw new BadRequestException(
        'software_pin is required when creating the platform DIAN configuration',
      );
    }

    const config = existingConfig
      ? await this.updateDianConfig(existingConfig.id, dto, {
          previous,
          // Si la fila quedó colgada de otra entidad contable, se realinea en la
          // escritura que el operador ya está haciendo. Normalizar al escribir
          // evita una migración de datos para un desajuste que solo existe
          // mientras nadie vuelve a guardar.
          realign_accounting_entity_id:
            existingConfig.accounting_entity_id === accounting_entity_id
              ? null
              : accounting_entity_id,
        })
      : await this.createDianConfig(dto, {
          organization_id: platform_organization_id,
          accounting_entity_id,
        });
    await this.ensureSingleDefault(config.id, config.organization_id, config.accounting_entity_id);

    const nextSettings: SubscriptionFiscalSettings = {
      ...previous,
      is_enabled: dto.is_enabled,
      auto_issue: dto.auto_issue,
      // `environment` se omite en edición normal; cuando no viene, conservamos
      // el ambiente vigente. La guarda de transición de más abajo se evalúa
      // contra `previous.environment` y rechaza la transición test→production
      // y la degradación production→test.
      environment: dto.environment ?? previous.environment,
      platform_organization_id,
      accounting_entity_id,
      dian_configuration_id: config.id,
      invoice_resolution_id: dto.invoice_resolution_id ?? null,
      updated_by_user_id: userId,
      updated_at: new Date().toISOString(),
    };

    const fingerprint = this.configFingerprint(config);
    const previousFingerprint =
      previous.last_test_result?.config_fingerprint ?? null;
    if (previousFingerprint !== fingerprint) {
      nextSettings.last_tested_at = null;
      nextSettings.last_test_result = null;
    }

    // ESTE `PATCH` YA NO ACTIVA PRODUCCIÓN. LA VÍA ES `promote-to-production`.
    //
    // Aquí vivía la única guarda de la promoción de la plataforma: certificado
    // presente + confirmación explícita + una prueba de CONEXIÓN de producción de
    // la última hora. Ninguna de las tres mira `enablement_status`, así que este
    // endpoint podía poner la plataforma a emitir en producción —y escribir
    // `enablement_status: 'enabled'` de paso— sin que la DIAN hubiera aprobado su
    // set de habilitación.
    //
    // El riel de tienda nunca permitió eso: su promoción exige `readiness.ready`,
    // que incluye `test_set_evidence`. Cerrar esta vía es lo que hace que las dos
    // tengan la misma guarda, en vez de que la de plataforma dependa de que la
    // DIAN rechace por su cuenta una conexión de software no habilitado —un
    // control real, pero externo y que no controlamos.
    //
    // Se bloquea la *TRANSICIÓN* (test→production), no la edición de una config
    // ya en producción. La guarda anterior rechazaba `environment:'production'`
    // de manera incondicional, y como `environment` es obligatorio en el DTO,
    // eso dejó al panel sin poder editar `name`, `auto_issue`, etc. estando
    // ya en producción. También rechaza la degradación producción→test: por
    // simetría, la única vía entre ambientes es `promote-to-production`.
    if (dto.environment === 'production' && previous.environment !== 'production') {
      throw new BadRequestException(
        'El paso a producción no se hace por este endpoint: usa POST ' +
          'superadmin/subscriptions/fiscal/promote-to-production, que exige el ' +
          'reporte de readiness completo (incluida la aprobación del set de ' +
          'pruebas por la DIAN). Consúltalo en GET ' +
          'superadmin/subscriptions/fiscal/production-readiness.',
      );
    }
    if (dto.environment === 'test' && previous.environment === 'production') {
      throw new BadRequestException(
        'No se puede degradar producción desde este endpoint: la única vía ' +
          'entre ambientes es promote-to-production, en sentido contrario. ' +
          'Si necesitas sacar la plataforma de producción, abre una incidencia.',
      );
    }

    await this.saveSettings(nextSettings);
    return this.getStatus();
  }

  async uploadCertificate(params: {
    file: Express.Multer.File;
    password: string;
    userId: number | null;
  }) {
    if (!params.file?.buffer?.length) {
      throw new BadRequestException('Certificate file is required');
    }
    if (!params.password?.trim()) {
      throw new BadRequestException('Certificate password is required');
    }

    const settings = await this.requireConfiguredSettings();
    if (!settings.dian_configuration_id) {
      throw new BadRequestException('DIAN configuration is required before uploading a certificate');
    }
    const config = await this.prisma.withoutScope().dian_configurations.findUnique({
      where: { id: settings.dian_configuration_id },
    });
    if (!config) {
      throw new BadRequestException('DIAN configuration not found');
    }

    const validation = await this.certificateAdapter.validateCertificate({
      p12_buffer: params.file.buffer,
      password: params.password.trim(),
      expected_tax_id: config.nit,
      expected_dv: config.nit_dv,
    });
    if (!validation.valid) {
      throw new BadRequestException(validation.error ?? 'Invalid certificate');
    }

    const key = `dian/platform/${config.id}/certificate-${Date.now()}.p12`;
    await this.s3Service.uploadFile(
      params.file.buffer,
      key,
      params.file.mimetype || 'application/x-pkcs12',
    );

    const updated = await this.prisma.withoutScope().dian_configurations.update({
      where: { id: config.id },
      data: {
        certificate_s3_key: key,
        certificate_password_encrypted: this.encryption.encrypt(
          params.password.trim(),
        ),
        certificate_expiry: validation.expires ?? null,
        certificate_fingerprint: validation.fingerprint ?? null,
        certificate_subject: validation.subject ?? null,
        certificate_issuer: validation.issuer ?? null,
        certificate_serial_number: validation.serial_number ?? null,
        certificate_nit: validation.tax_id ?? null,
        certificate_source: 'manual_upload_validated',
        certificate_uploaded_at: new Date(),
        updated_at: new Date(),
      },
    });

    const nextSettings = {
      ...settings,
      last_tested_at: null,
      last_test_result: null,
      updated_by_user_id: params.userId,
      updated_at: new Date().toISOString(),
    };
    await this.saveSettings(nextSettings);

    return this.maskConfig(updated);
  }

  async testConnection(
    userId: number | null,
  ): Promise<NonNullable<SubscriptionFiscalSettings['last_test_result']>> {
    const settings = await this.requireConfiguredSettings();
    const config = await this.getActiveConfig(settings);
    const fingerprint = this.configFingerprint(config);
    const environment = config.environment as SubscriptionFiscalEnvironment;

    let wsCredentials: WsSecurityCredentials | undefined;
    if (config.certificate_s3_key && config.certificate_password_encrypted) {
      const certPassword = this.encryption.decrypt(
        config.certificate_password_encrypted,
      );
      const p12Buffer = await this.s3Service.downloadImage(config.certificate_s3_key);
      wsCredentials = this.dianXmlSigner.buildWsCredentials(
        p12Buffer,
        certPassword,
        config.certificate_kms_key_id,
      );
    }

    const response = await this.dianSoapClient.getStatus(
      '00000000-0000-0000-0000-000000000000',
      environment,
      wsCredentials,
    );
    const ok =
      response.success ||
      response.is_soap_fault === true ||
      (response.status_code !== 'NETWORK_ERROR' &&
        response.status_code !== 'TIMEOUT' &&
        (response.raw_response ?? '').includes('Envelope'));
    const message = ok
      ? 'Conexión exitosa con los servicios DIAN'
      : 'No se pudo conectar con los servicios DIAN';

    const testedAt = new Date().toISOString();
    const testResult: NonNullable<SubscriptionFiscalSettings['last_test_result']> = {
      ok,
      message,
      dian_status: response.status_code,
      environment,
      config_fingerprint: fingerprint,
      tested_at: testedAt,
    };
    const nextSettings: SubscriptionFiscalSettings = {
      ...settings,
      last_tested_at: testedAt,
      last_test_result: testResult,
      updated_by_user_id: userId,
      updated_at: testedAt,
    };
    await this.saveSettings(nextSettings);
    await this.prisma.withoutScope().dian_configurations.update({
      where: { id: config.id },
      data: {
        last_test_result: nextSettings.last_test_result as Prisma.InputJsonValue,
        enablement_status: environment === 'test' ? 'testing' : config.enablement_status,
        updated_at: new Date(),
      },
    });

    return testResult;
  }

  // ─────────────────────────────────────────────────────────
  // DIAN test set (habilitación) for the platform's own NIT
  // ─────────────────────────────────────────────────────────

  /**
   * Runs `DianTestService` — the same, already-hardened store implementation —
   * under a platform request context.
   *
   * `DianTestService` reads through the scoped `StorePrismaService`, so it needs
   * a context to exist. The platform has an organization but no store, and that
   * is exactly the shape the scopes already handle: `dian_configurations` scopes
   * as `organization_id` + `OR[store_id = ctx.store_id, store_id IS NULL]`
   * (with `store_id` undefined the OR is satisfied by the NULL branch), and
   * fiscal-entity models fall back to `store_id IS NULL`, which is where the
   * platform's resolution lives.
   *
   * Without this, Vendix could store DIAN credentials for its own NIT but had no
   * way to submit the 50-document test set that DIAN requires before enabling
   * production — the platform rail stopped one step short of usable.
   */
  /**
   * Quita `note_phase` del registro del lote antes de mandarlo al cliente.
   *
   * `note_phase.deferred[]` guarda cada nota retenida con su XML FIRMADO, porque su
   * consecutivo ya está reservado dentro de ese XML y regenerarla daría otro CUDE.
   * Imprescindible en base, y pésimo en una respuesta que el panel sondea: 20
   * documentos firmados por consulta, que la UI no puede usar.
   *
   * El recuento y la razón viajan aparte, vía `buildNotePhaseView`.
   */
  private stripNotePhase(last_test_result: unknown): unknown {
    if (!last_test_result || typeof last_test_result !== 'object') {
      return last_test_result;
    }
    const { note_phase: _omitted, ...rest } = last_test_result as Record<
      string,
      any
    >;
    return rest;
  }

  private async runInPlatformContext<T>(
    settings: SubscriptionFiscalSettings,
    fn: () => Promise<T>,
  ): Promise<T> {
    return RequestContextService.runIsolated(
      {
        organization_id: settings.platform_organization_id!,
        store_id: undefined,
        user_id: RequestContextService.getUserId(),
        is_super_admin: true,
        is_owner: false,
        roles: ['super_admin'],
        permissions: [],
        app_type: 'VENDIX_ADMIN',
      },
      fn,
    );
  }

  /** Config + resolution ids the test set needs, or a 412 naming what is missing. */
  private async requireTestSetTargets(): Promise<{
    settings: SubscriptionFiscalSettings;
    configId: number;
    resolutionId: number;
  }> {
    const settings = await this.requireConfiguredSettings();
    const config = await this.getActiveConfig(settings);
    if (!settings.invoice_resolution_id) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_FISCAL_001,
        'Registra la resolución de numeración de la plataforma antes de enviar el set de pruebas.',
        { field: 'invoice_resolution_id' },
      );
    }
    return {
      settings,
      configId: config.id,
      resolutionId: settings.invoice_resolution_id,
    };
  }

  /**
   * Encola el set de pruebas de la plataforma y devuelve el id del job.
   *
   * El encolado ocurre DENTRO de `runInPlatformContext` a propósito: ahí es donde
   * existe el contexto de plataforma (`store_id: undefined`, la organización como
   * identidad fiscal), y `enqueueTestSet` lo fotografía en el payload para que el
   * worker lo restaure. Encolar fuera guardaría el contexto del superadmin y el
   * worker resolvería otra entidad fiscal — o ninguna.
   */
  async runTestSet(
    options: { smoke?: boolean; validate_only?: boolean } = {},
  ): Promise<{ job_id: string }> {
    const { settings, configId, resolutionId } =
      await this.requireTestSetTargets();
    return this.runInPlatformContext(settings, () =>
      this.dianTestService.enqueueTestSet(configId, resolutionId, options),
    );
  }

  /**
   * Estado del job encolado. La `configId` que autoriza la lectura la resuelve
   * `requireTestSetTargets` desde los ajustes de plataforma, no el llamador, así
   * que un id de job ajeno no puede colarse por la ruta.
   */
  async getTestSetJobStatus(jobId: string) {
    const { settings, configId } = await this.requireTestSetTargets();
    return this.runInPlatformContext(settings, () =>
      this.dianTestService.getTestSetJobStatus(jobId, configId),
    );
  }

  async checkTestSetStatus() {
    const { settings, configId } = await this.requireTestSetTargets();
    return this.runInPlatformContext(settings, () =>
      this.dianTestService.checkTestSetStatus(configId),
    );
  }

  async getTestSetDocuments(sampleSize?: number) {
    const { settings, configId } = await this.requireTestSetTargets();
    return this.runInPlatformContext(settings, () =>
      this.dianTestService.getTestSetDocumentStatus(configId, sampleSize),
    );
  }

  async abandonTestSet() {
    const { settings, configId } = await this.requireTestSetTargets();
    return this.runInPlatformContext(settings, () =>
      this.dianTestService.abandonTestSet(configId),
    );
  }

  // ─────────────────────────────────────────────────────────
  // Numeración autorizada — la MISMA consulta que ve un tenant
  // ─────────────────────────────────────────────────────────

  /**
   * Comprueba que el id que llegó por ruta es LA configuración de la plataforma.
   *
   * ── POR QUÉ SE VALIDA Y NO SE IGNORA EL PARÁMETRO ──────────────────────────
   *
   * La plataforma tiene UNA sola configuración DIAN, y el `configId` autorizado
   * lo resuelven los ajustes, no el llamador — igual que en
   * `requireTestSetTargets`. Aceptar el id de la ruta tal cual convertiría estas
   * dos rutas en una vía para consultar y, peor, ESCRIBIR la clave técnica de la
   * configuración de cualquier tenant desde el riel de plataforma: el contexto
   * que se monta abajo es el de la organización 1, así que la escritura caería en
   * la entidad fiscal equivocada sin que nada la rechace.
   *
   * Se rechaza en vez de sustituirse en silencio: si la pantalla pidió otro id es
   * porque su estado no es el que cree, y responderle sobre una configuración que
   * no pidió le haría atribuir a la suya un veredicto ajeno.
   *
   * ── POR QUÉ NO SE EXIGE LA RESOLUCIÓN ──────────────────────────────────────
   *
   * `requireTestSetTargets` reclama `invoice_resolution_id` porque sin resolución
   * no hay consecutivo que numerar. Aquí sería contradictorio: estas rutas
   * existen precisamente para TRAER la resolución de la DIAN, así que exigirla
   * las volvería inalcanzables justo cuando sirven. Mismo criterio que
   * `getProductionReadiness`.
   */
  private async requirePlatformDianConfig(configId: number): Promise<{
    settings: SubscriptionFiscalSettings;
    configId: number;
  }> {
    const settings = await this.requireConfiguredSettings();
    const config = await this.getActiveConfig(settings);

    if (config.id !== configId) {
      throw new VendixHttpException(
        ErrorCodes.DIAN_CONFIG_001,
        `La configuración DIAN ${configId} no es la de la plataforma. Este riel opera sobre una sola configuración: recarga la pantalla para leer la que está vigente.`,
        {
          dian_configuration_id: configId,
          platform_dian_configuration_id: config.id,
        },
      );
    }

    return { settings, configId: config.id };
  }

  /**
   * Rangos que la DIAN tiene AUTORIZADOS para el NIT de la plataforma, cruzados
   * con las resoluciones guardadas. NO escribe nada.
   *
   * ── POR QUÉ ESTE ENDPOINT NO EXISTÍA Y POR QUÉ IMPORTA ─────────────────────
   *
   * El riel de tiendas ya expone `GetNumberingRange`; el de plataforma no, así
   * que la resolución y la clave técnica con las que Vendix factura sus propias
   * suscripciones se teclean del portal MUISCA. Esa es la causa raíz exacta del
   * FAD06: la «clave actual vigente» que muestra el portal es la que se usaría
   * para una resolución NUEVA, y la DIAN recomputa el CUFE con la clave LIGADA a
   * la resolución. Los dos chequeos de ClTec del readiness sólo leen nuestra
   * propia base, así que ninguno puede detectarlo: `technical_key_matches` —que
   * el servicio calcula EN EL SERVIDOR vía `technicalKeyVault.reveal()` y del que
   * sólo sale un booleano— es el único dato que confronta lo guardado con lo que
   * la DIAN tiene ligado a la resolución.
   *
   * La ClTec NO viaja al cliente en ninguna de las dos rutas.
   */
  async queryPlatformNumberingRanges(
    configId: number,
  ): Promise<NumberingRangeReport> {
    const { settings, configId: target } =
      await this.requirePlatformDianConfig(configId);
    return this.runInPlatformContext(settings, () =>
      this.dianNumberingRangeService.queryRanges(target),
    );
  }

  /**
   * Trae a `invoice_resolutions` los rangos SELECCIONADOS de la DIAN.
   *
   * El cuerpo sólo SELECCIONA por el par `(resolution_number, prefix)`: los
   * valores —clave técnica incluida— salen de la respuesta de la DIAN, nunca del
   * payload. Cada elemento se resuelve por su cuenta, así que un lote
   * parcialmente aplicado es un desenlace legítimo y viaja en `results[]`.
   *
   * Va DENTRO de `runInPlatformContext` por lo mismo que `runTestSet`: la
   * escritura resuelve su entidad fiscal desde el contexto, y fuera de él sería
   * la del super admin —o ninguna—, dejando la resolución colgada de la entidad
   * equivocada o invisible en los listados.
   */
  async applyPlatformNumberingRanges(
    configId: number,
    dto: ApplyNumberingRangesDto,
  ): Promise<ApplyNumberingRangesResult> {
    const { settings, configId: target } =
      await this.requirePlatformDianConfig(configId);
    return this.runInPlatformContext(settings, () =>
      this.dianNumberingRangeService.applyRanges(target, dto),
    );
  }

  // ─────────────────────────────────────────────────────────
  // Paso a producción — el mismo reporte y la misma guarda que un tenant
  // ─────────────────────────────────────────────────────────

  /**
   * Qué falta para que la PLATAFORMA pueda emitir en producción.
   *
   * POR QUÉ ESTE ENDPOINT NO EXISTÍA Y POR QUÉ IMPORTA
   *
   * Este riel tenía `habilitation_readiness` —«¿puedo siquiera empezar?»— y no el
   * reporte de producción —«¿puedo salir a producción?»—, que es el que contiene
   * el chequeo `test_set_evidence`. Sin él, la única guarda de la promoción era
   * una prueba de conexión reciente, que no dice nada sobre si la DIAN aprobó el
   * set de habilitación.
   *
   * Delega en la implementación de tienda bajo contexto de plataforma, igual que
   * `runTestSet` delega en `DianTestService`. Un segundo reporte se habría
   * desviado del primero, que es exactamente el defecto que este método cierra.
   *
   * NO exige la resolución de numeración por adelantado: este reporte existe para
   * DECIR qué falta, y su chequeo `production_resolution` ya lo cubre con un texto
   * que explica el trámite en Muisca. Pedirla antes lo haría inalcanzable justo
   * cuando más sirve.
   */
  async getProductionReadiness() {
    const settings = await this.requireConfiguredSettings();
    const config = await this.getActiveConfig(settings);
    return this.runInPlatformContext(settings, () =>
      this.dianConfigService.getProductionReadiness(config.id),
    );
  }

  /**
   * Pasa la plataforma a producción, con la guarda completa de readiness.
   *
   * EL AMBIENTE DE LA PLATAFORMA VIVE EN DOS SITIOS, Y LOS DOS SE ESCRIBEN
   *
   * `dian_configurations.environment` es el que lee el proveedor DIAN al firmar y
   * transmitir; `platform_settings.value.environment` es el que lee este riel para
   * decidir si emite factura de suscripción. Escribir solo uno deja la plataforma
   * firmando contra producción mientras su propio panel se cree en sandbox, o al
   * revés. `promoteToProduction` de tienda cubre el primero; el segundo es propio
   * de este riel y se escribe acá.
   */
  async promoteToProduction() {
    const settings = await this.requireConfiguredSettings();
    const config = await this.getActiveConfig(settings);

    // La guarda vive en la implementación de tienda: lanza con la lista completa
    // de faltantes si el readiness no está listo, así que acá no se repite ninguna
    // condición. Si esto devuelve, la promoción de la configuración ya ocurrió.
    const promoted = await this.runInPlatformContext(settings, () =>
      this.dianConfigService.promoteToProduction(config.id),
    );

    await this.saveSettings({
      ...settings,
      environment: 'production',
      // La promoción es la afirmación de que la plataforma emite: dejar
      // `is_enabled` en falso produciría una configuración en producción que este
      // riel no usa, y el operador no tendría dónde ver la contradicción.
      is_enabled: true,
      updated_by_user_id: RequestContextService.getUserId() ?? null,
      updated_at: new Date().toISOString(),
    });

    this.logger.log(
      `Platform DIAN config ${config.id} promoted to production via promote-to-production`,
    );

    return { promoted, status: await this.getStatus() };
  }

  async listTransmissions(query: SubscriptionFiscalQueryDto) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(Math.max(1, query.limit ?? 20), 100);
    const where: Prisma.fiscal_transmissionsWhereInput = {
      source_type: 'subscription_invoice',
    };
    if (query.status) {
      where.transmission_status = query.status as any;
    }
    if (query.environment) {
      where.dian_configuration = { environment: query.environment };
    }
    if (query.search?.trim()) {
      const search = query.search.trim();
      where.OR = [
        { document_number: { contains: search, mode: 'insensitive' } },
        { cufe: { contains: search, mode: 'insensitive' } },
        { error_message: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.withoutScope().fiscal_transmissions.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          dian_configuration: {
            select: { id: true, name: true, environment: true, enablement_status: true },
          },
        },
      }),
      this.prisma.withoutScope().fiscal_transmissions.count({ where }),
    ]);

    const invoiceIds = rows.map((row) => row.source_id);
    const invoices = invoiceIds.length
      ? await this.prisma.withoutScope().subscription_invoices.findMany({
          where: { id: { in: invoiceIds } },
          select: {
            id: true,
            invoice_number: true,
            state: true,
            total: true,
            currency: true,
            store_id: true,
            issued_at: true,
            created_at: true,
          },
        })
      : [];
    const invoiceById = new Map(invoices.map((invoice) => [invoice.id, invoice]));

    return {
      data: rows.map((row) => ({
        ...row,
        subscription_invoice: invoiceById.get(row.source_id) ?? null,
      })),
      total,
      page,
      limit,
    };
  }

  async issueForInvoice(
    invoiceId: number,
    opts: { manual?: boolean; source?: string } = {},
  ) {
    const settings = await this.getSettings();
    if (!settings.is_enabled) {
      // F-R2-9: el log es JSON estructurado para que Loki/Datadog pueda
      // filtrar por `event`, `reason` o `subscription_invoice_id` sin regex.
      this.logger.warn({
        event: 'fiscal.issue.skipped',
        reason: 'subscription_fiscal_billing_disabled',
        subscription_invoice_id: invoiceId,
        source: opts.source ?? 'auto',
        manual: opts.manual ?? false,
      });
      return {
        skipped: true,
        reason: 'subscription_fiscal_billing_disabled',
      };
    }
    if (!settings.auto_issue && !opts.manual) {
      this.logger.warn({
        event: 'fiscal.issue.skipped',
        reason: 'subscription_fiscal_auto_issue_disabled',
        subscription_invoice_id: invoiceId,
        source: opts.source ?? 'auto',
        manual: opts.manual ?? false,
      });
      return {
        skipped: true,
        reason: 'subscription_fiscal_auto_issue_disabled',
      };
    }

    const invoice = await this.loadSubscriptionInvoice(invoiceId);
    if (invoice.state !== 'paid') {
      if (opts.manual) {
        throw new BadRequestException('Only paid subscription invoices can be issued electronically');
      }
      this.logger.warn({
        event: 'fiscal.issue.skipped',
        reason: 'subscription_invoice_not_paid',
        subscription_invoice_id: invoiceId,
        source: opts.source ?? 'auto',
        state: invoice.state,
      });
      return { skipped: true, reason: 'subscription_invoice_not_paid' };
    }

    // Completeness gate BEFORE ensureTransmission — that call allocates the
    // fiscal consecutive, and a rejected document still burns its number.
    const missing = this.missingCustomerFiscalData(invoice);
    if (missing.length > 0) {
      const detail = {
        subscription_invoice_id: invoiceId,
        organization_id:
          invoice.store_subscription.store.organizations?.id ?? null,
        missing_fields: missing,
      };
      if (opts.manual) {
        throw new VendixHttpException(
          ErrorCodes.SUBSCRIPTION_FISCAL_001,
          `The organization is missing fiscal data required by DIAN: ${missing.join(', ')}`,
          detail,
        );
      }
      this.logger.warn(
        `Subscription fiscal issue skipped invoice=${invoiceId} source=${opts.source ?? 'auto'}: subscription_customer_fiscal_data_incomplete (missing=${missing.join(', ')})`,
      );
      return {
        skipped: true,
        reason: 'subscription_customer_fiscal_data_incomplete',
        missing_fields: missing,
      };
    }

    const config = await this.getActiveConfig(settings);

    // La resolución que respalda el consecutivo de esta transmisión. Se carga aquí
    // y no dentro de `buildProviderData` porque esa función es sincrónica y debe
    // seguir siéndolo: armar el payload no debe poder tocar la base.
    //
    // SUBIÓ de después de `ensureTransmission` a antes, y no es cosmético: la
    // prevalidación de abajo necesita la resolución para juzgar el número, el
    // rango y la ClTec, y toda comprobación que ocurra DESPUÉS de
    // `ensureTransmission` llega tarde — ahí el consecutivo ya está gastado. La
    // llamada es de sólo lectura, así que adelantarla no tiene efectos.
    const resolution = await this.loadInvoiceResolution(settings);

    // ── PREVALIDACIÓN, Y VA AQUÍ POR UNA RAZÓN CONCRETA ──────────────────────
    //
    // El carril de tiendas lo dice literal en `invoice-flow.service.ts:1274-1278`:
    // «va acá y no en `send()` porque después de `send()` el consecutivo ya se
    // gastó: el 14/08/2026 una ClTec de 38 caracteres hizo rechazar una factura
    // real y quemó un consecutivo autorizado que no se recupera».
    //
    // El carril de plataforma no tenía NADA de esto. Entre la única comprobación
    // que existía (`missingCustomerFiscalData`, seis campos y sólo por presencia)
    // y el envío a la DIAN mediaban `ensureTransmission` —que consume el
    // consecutivo— y nada más. El 17/08/2026 eso costó el rechazo de la primera
    // factura de suscripción emitida.
    //
    // Los dos validadores que se corren son los MISMOS del carril de tiendas, sin
    // copia ni variante: son `@Injectable()` puros, sin Prisma, y el precedente de
    // reuso cross-carril ya está establecido en este archivo con
    // `DianNumberingRangeService`. Que la plataforma juzgue con reglas propias es
    // exactamente cómo se llega a que un carril emita lo que el otro rechaza.
    const readiness = this.evaluateEmitReadiness(invoice, resolution);
    if (!readiness.emittable) {
      const detail = {
        subscription_invoice_id: invoiceId,
        document_number_preview: readiness.document_number_preview,
        blockers: readiness.blockers,
        warnings: readiness.warnings,
        computed: readiness.computed,
      };
      if (opts.manual) {
        throw new VendixHttpException(
          ErrorCodes.SUBSCRIPTION_FISCAL_001,
          `La factura no se puede emitir todavía: ${readiness.blockers[0]?.problem ?? 'hay datos fiscales incompletos'} ${
            readiness.blockers[0]?.fix ?? ''
          }`.trim(),
          detail,
        );
      }
      this.logger.warn(
        `Subscription fiscal issue skipped invoice=${invoiceId} source=${opts.source ?? 'auto'}: prevalidation_failed (blockers=${readiness.blockers
          .map((b) => b.code)
          .join(', ')})`,
      );
      return {
        skipped: true,
        reason: 'prevalidation_failed',
        blockers: readiness.blockers,
        warnings: readiness.warnings,
      };
    }

    // Los avisos no bloquean —son ausencias que hacen al documento decir menos,
    // no decir algo falso— pero sí se registran: son la lista de lo que hoy se
    // emite a medias.
    for (const warning of readiness.warnings) {
      this.logger.warn(
        `Subscription invoice #${invoiceId} — ${warning.code} (${warning.field}): ${warning.problem}`,
      );
    }

    const transmission = await this.ensureTransmission(invoice, settings, config);
    if (transmission.transmission_status === 'accepted') {
      return { skipped: false, transmission, already_accepted: true };
    }

    // FUERA del `try` a propósito. `markSubmitted` ahora lanza cuando la
    // transmisión ya es terminal (`accepted` / `cancelled`), y dentro del `try`
    // ese throw caería en el `catch` de abajo, que llama a `markError`: la
    // transmisión ACEPTADA quedaría reescrita como fallida por el mismo guardián
    // que existe para protegerla. El error tiene que salir crudo.
    await this.markSubmitted(transmission.id);

    try {
      const response = await RequestContextService.runIsolated(
        {
          organization_id: settings.platform_organization_id!,
          store_id: undefined,
          user_id: RequestContextService.getUserId(),
          is_super_admin: true,
          is_owner: false,
          roles: ['super_admin'],
          permissions: [],
          app_type: 'VENDIX_ADMIN',
        },
        () =>
          this.dianProvider.sendInvoice(
            this.buildProviderData(
              invoice,
              transmission.document_number,
              resolution,
            ),
          ),
      );

      if (response.success) {
        await this.markAccepted(transmission.id, response);
      } else {
        await this.markRejected(transmission.id, response);
      }
    } catch (error) {
      await this.markError(transmission.id, error);
      this.logger.warn(
        `Subscription fiscal issue failed invoice=${invoiceId} transmission=${transmission.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return this.prisma.withoutScope().fiscal_transmissions.findUnique({
      where: { id: transmission.id },
    });
  }

  /**
   * ¿Puede emitirse esta factura de suscripción, SIN emitirla?
   *
   * Espejo de `GET /store/invoicing/:id/emit-readiness`
   * (`invoicing.controller.ts:285`), que el carril de tiendas expone para que
   * nadie tenga que gastar un consecutivo para descubrir que faltaba un dato.
   *
   * No escribe nada: ni transmisión, ni número, ni estado. Corre exactamente las
   * mismas comprobaciones que `issueForInvoice` corre antes de numerar, con un
   * número de SONDEO —el que se asignaría— para que las reglas de rango y de
   * formato se juzguen sobre el valor real y no sobre un hueco.
   */
  async getEmitReadiness(invoiceId: number): Promise<SubscriptionEmitReadiness> {
    const settings = await this.getSettings();
    const invoice = await this.loadSubscriptionInvoice(invoiceId);
    const resolution = await this.loadInvoiceResolution(settings);
    return this.evaluateEmitReadiness(invoice, resolution);
  }

  /**
   * El motor de la prevalidación, compartido por la puerta de emisión y por el
   * endpoint de sólo lectura.
   *
   * Sincrónico y sin base de datos a propósito: quien lo llama ya cargó factura y
   * resolución, y así el mismo veredicto se puede ejercitar en un test con
   * literales. Si tocara la base, el endpoint de consulta y la puerta de emisión
   * acabarían leyendo estados distintos y dando respuestas distintas — que es
   * justo la divergencia que esto existe para cerrar.
   */
  private evaluateEmitReadiness(
    invoice: SubscriptionInvoiceForFiscal,
    resolution: PlatformInvoiceResolution,
  ): SubscriptionEmitReadiness {
    const blockers: SubscriptionEmitBlocker[] = [];
    const warnings: SubscriptionEmitBlocker[] = [];

    // 1. Completitud — la comprobación que ya existía. Se conserva porque nombra
    //    los campos por su nombre de negocio («tax_id», «address»), que es lo que
    //    quien tiene que arreglarlos reconoce.
    const missing = this.missingCustomerFiscalData(invoice);
    for (const field of missing) {
      blockers.push({
        source: 'completeness',
        code: 'CUSTOMER_FISCAL_DATA_MISSING',
        field,
        problem: `La organización no tiene «${field}», y la DIAN lo exige para identificar al adquiriente.`,
        fix: 'Complétalo en los datos fiscales de la organización antes de emitir.',
      });
    }

    // 2. Número de SONDEO — el que se asignaría, con el mismo suelo que aplica
    //    `allocateFiscalNumber`. Sin nivelar, una resolución cuyo cursor derivó a
    //    cero sondearía el número 1 y la regla de rango lo denunciaría por un
    //    motivo que la asignación real ya corrige: un falso positivo.
    const floor = resolution.range_from - 1;
    const cursor =
      resolution.current_number < floor ? floor : resolution.current_number;
    const document_number_preview = `${resolution.prefix}${cursor + 1}`;

    // 3. Identidad del adquiriente. `nominative` sin discusión: una factura de
    //    suscripción se emite A NOMBRE del cliente que la paga; el Consumidor
    //    Final es la venta de mostrador a quien no pide factura nominativa, y no
    //    existe en este riel.
    const identity = this.identityValidator.validate(
      this.buildCustomerIdentityInput(invoice),
    );
    for (const finding of identity.findings) {
      const entry: SubscriptionEmitBlocker = {
        source: 'identity',
        code: finding.code,
        field: finding.field,
        problem: finding.problem,
        fix: finding.fix,
        details: finding.details,
      };
      if (finding.severity === 'blocker') blockers.push(entry);
      else warnings.push(entry);
    }

    // 4. El documento completo, armado EXACTAMENTE como se va a emitir. Se usa el
    //    mismo `buildProviderData` que alimenta al proveedor: prevalidar un
    //    payload distinto del que viaja es aprobar un documento que no existe.
    const provider_data = this.buildProviderData(
      invoice,
      document_number_preview,
      resolution,
    );
    const document = this.documentValidator.validate(
      this.buildFiscalDocumentInput(provider_data, resolution),
    );
    for (const finding of document.findings) {
      const entry: SubscriptionEmitBlocker = {
        source: 'document',
        code: finding.code,
        field: finding.field,
        problem: finding.problem,
        fix: finding.fix,
        details: finding.details,
        dian_rule: finding.dian_rule?.id ?? null,
      };
      if (finding.severity === 'blocker') blockers.push(entry);
      else warnings.push(entry);
    }

    return {
      emittable: blockers.length === 0,
      subscription_invoice_id: invoice.id,
      document_number_preview,
      resolution_id: resolution.id,
      blockers,
      warnings,
      computed: document.computed,
    };
  }

  /**
   * El adquiriente, en el contrato que juzga `CustomerFiscalIdentityValidator`.
   *
   * Se compone desde `buildProviderData` y no desde la fila de organización
   * directamente, para que el validador juzgue los MISMOS valores que el emisor
   * va a escribir —incluida la partición NIT/DV, que no es trivial: la mayoría de
   * filas guardan el NIT con el DV incrustado, y concatenarlos produce un número
   * que no es de nadie.
   */
  private buildCustomerIdentityInput(
    invoice: SubscriptionInvoiceForFiscal,
  ): CustomerFiscalIdentityInput {
    const org = invoice.store_subscription.store.organizations;
    const { number, dv } = org
      ? this.splitCustomerNit(org)
      : { number: undefined, dv: undefined };
    const address = this.buildCustomerAddress(org);

    const documentType = org?.document_type ?? (org?.tax_id ? '31' : '13');
    const isNit = documentType === '31' || documentType === 'NIT';

    return {
      identification_mode: 'nominative',
      document_type: documentType,
      document_number: number ?? null,
      verification_digit: isNit ? (dv ?? null) : null,
      // `organizations.person_type` guarda el CÓDIGO DIAN (`'1'`/`'2'`), no el
      // enum del validador. Sin traducir, cada factura de suscripción levantaba
      // un `PERSON_TYPE_UNKNOWN` sobre un dato correcto, y una advertencia que
      // siempre aparece deja de leerse.
      person_type: normalizePersonType(org?.person_type),
      legal_name:
        org?.legal_name ??
        org?.name ??
        invoice.store_subscription.store.name ??
        null,
      tax_regime: normalizeAcquirerTaxRegime(org?.tax_regime),
      tax_responsibilities: org?.fiscal_responsibilities?.length
        ? org.fiscal_responsibilities
        : null,
      email: org?.email ?? null,
      address: address
        ? {
            address_line: address.address_line ?? null,
            city_code: address.city_code ?? null,
            city_name: address.city_name ?? null,
            department_code: address.department_code ?? null,
            department_name: address.department_name ?? null,
            country_code: address.country_code ?? null,
            postal_code: address.postal_code ?? null,
          }
        : null,
    };
  }

  /**
   * El documento, en el contrato que juzga `FiscalDocumentValidator`.
   *
   * `operation_type` viaja como `null` porque `ProviderInvoiceData` no lo lleva:
   * la factura de suscripción es una operación estándar y el builder emite el
   * `cbc:CustomizationID` por defecto. Declarar aquí un valor inventado activaría
   * `OPERATION_TYPE_UNKNOWN` sobre un campo que el XML no publica.
   */
  private buildFiscalDocumentInput(
    provider_data: ProviderInvoiceData,
    resolution: PlatformInvoiceResolution,
  ): FiscalDocumentValidationInput {
    return {
      document_type: 'sales_invoice',
      invoice_number: provider_data.invoice_number,
      issue_date: provider_data.issue_date,
      timezone: PLATFORM_TIMEZONE,
      currency: provider_data.currency,
      operation_type: null,
      subtotal_amount: provider_data.subtotal_amount,
      discount_amount: provider_data.discount_amount,
      tax_amount: provider_data.tax_amount,
      withholding_amount: provider_data.withholding_amount,
      total_amount: provider_data.total_amount,
      items: provider_data.items.map((item, index) => ({
        line_number: index + 1,
        description: item.description,
        quantity: item.quantity,
        unit_price: item.unit_price,
        discount_amount: item.discount_amount,
        tax_amount: item.tax_amount,
        unit_code: item.unit_code ?? null,
      })),
      taxes: provider_data.taxes.map((tax) => ({
        tax_name: tax.tax_name,
        tax_type: tax.tax_type ?? null,
        tax_rate: tax.tax_rate,
        taxable_amount: tax.taxable_amount,
        tax_amount: tax.tax_amount,
      })),
      resolution: {
        id: resolution.id,
        resolution_number: resolution.resolution_number,
        prefix: resolution.prefix,
        range_from: resolution.range_from,
        range_to: resolution.range_to,
        current_number: resolution.current_number,
        valid_from: resolution.valid_from,
        valid_to: resolution.valid_to,
        is_active: resolution.is_active,
        // Por la BÓVEDA, la misma lectura que hashea el CUFE. Leer aquí la plana
        // sería validar una clave distinta de la que se va a firmar.
        technical_key: this.technicalKeyVault.reveal(resolution) ?? null,
      },
    };
  }

  /**
   * Adquiriente en el contrato de `CustomerFiscalIdentityValidator`, desde el
   * `dto.customer` de `createPlatformInvoice`. Espejo de
   * `buildCustomerIdentityInput` (que lee de `organizations`): mismos campos,
   * misma coerción de tipos. La rama del frontend manda lo que el riel tienda
   * lee de la organización, así que el contrato que valida el validador es
   * el MISMO.
   */
  private buildPlatformCustomerIdentityInput(
    dto: CreatePlatformInvoiceDto,
  ): CustomerFiscalIdentityInput {
    const documentType = dto.customer.document_type ?? '31';
    const isNit = documentType === '31' || documentType === 'NIT';

    return {
      identification_mode: 'nominative',
      document_type: documentType,
      document_number: dto.customer.tax_id ?? null,
      // El DV sólo es relevante para NIT (Anexo 19). Cédula, CE y Pasaporte
      // NO llevan DV — pasarlo aunque sea undefined dispara falsos positivos.
      verification_digit: isNit ? (dto.customer.tax_id_dv ?? null) : null,
      // `customer.person_type` guarda el CÓDIGO DIAN (`'1'`/`'2'`), no la
      // etiqueta del validador. Sin traducir, cada factura legítima
      // levantaba un `PERSON_TYPE_UNKNOWN` sobre un dato correcto.
      person_type: normalizePersonType(dto.customer.person_type),
      legal_name: dto.customer.legal_name ?? null,
      tax_regime: normalizeAcquirerTaxRegime(dto.customer.tax_regime_code),
      tax_responsibilities: dto.customer.fiscal_responsibilities?.length
        ? dto.customer.fiscal_responsibilities
        : null,
      email: dto.customer.email ?? null,
      address: dto.customer.address_line
        ? {
            address_line: dto.customer.address_line,
            city_code: null,
            city_name: dto.customer.city ?? null,
            department_code: dto.customer.department_code ?? null,
            department_name: null,
            country_code: 'CO',
            postal_code: null,
          }
        : null,
    };
  }

  /**
   * Arma el `ProviderInvoiceData` que firma el emisor DIAN. Vive como helper
   * para que los pre-validadores (F4) puedan correr ANTES de
   * `allocateFiscalNumber` con el NÚMERO DE SONDEO, y después —ya con la
   * numeración real bajo el lock consultivo— se mutan sólo
   * `invoice_number` y `control.resolution_id`. Items, totales, taxes,
   * withholdings y todo lo que validan los pre-validadores se mantiene
   * idéntico entre el sondeo y la asignación real.
   */
  private buildPlatformProviderData(
    dto: CreatePlatformInvoiceDto,
    fiscalNumber: string,
    resolution: PlatformInvoiceResolution,
    issuedAt: Date,
    issuedAtTime: string,
    dueAt: string,
    issueAtLocal: string,
    lineItems: any[],
    subtotal: number,
    taxAmount: number,
    total: number,
    withholdingAmount: number,
    hasAnyTax: boolean,
    notesText: string,
  ): ProviderInvoiceData {
    const customerDocumentType = dto.customer.document_type ?? '31';
    const customerPersonType = dto.customer.person_type ?? '2';
    const customerRegime = dto.customer.tax_regime_code ?? '49';
    const customerResponsibilities =
      dto.customer.fiscal_responsibilities ??
      (customerRegime === '49' ? ['O-13'] : [customerRegime]);

    return {
      invoice_number: fiscalNumber,
      invoice_type: 'sales_invoice',
      issue_date: issueAtLocal,
      issue_time: issuedAtTime,
      due_date: dueAt,
      invoice_period: {
        start_date: dto.period_start
          ? localDateString(new Date(dto.period_start), PLATFORM_TIMEZONE)
          : issueAtLocal,
        end_date: dto.period_end
          ? localDateString(new Date(dto.period_end), PLATFORM_TIMEZONE)
          : issueAtLocal,
      },
      customer_name: dto.customer.legal_name,
      customer_tax_id: dto.customer.tax_id,
      customer_email: dto.customer.email ?? null,
      customer_address: dto.customer.address_line
        ? {
            line: dto.customer.address_line,
            city: dto.customer.city ?? null,
            department_code: dto.customer.department_code ?? null,
            country_code: 'CO',
          }
        : null,
      customer_document_type: customerDocumentType,
      customer_verification_digit: dto.customer.tax_id_dv ?? null,
      customer_person_type: customerPersonType,
      customer_regime: customerRegime,
      customer_tax_responsibilities: customerResponsibilities,
      subtotal_amount: subtotal.toFixed(2),
      discount_amount: dto.items
        .reduce((acc, it) => acc + Number(it.discount_amount ?? 0), 0)
        .toFixed(2),
      tax_amount: taxAmount.toFixed(2),
      withholding_amount: withholdingAmount.toFixed(2),
      total_amount: total.toFixed(2),
      currency: 'COP',
      ...(function buildExchangeRate() {
        const cur = dto.exchange_rate_payload;
        if (!cur) return {};
        const foreign = cur.iso_4217;
        if (!foreign || foreign.toUpperCase() === 'COP') return {};
        const rateRaw = Number(cur.exchange_rate);
        if (!Number.isFinite(rateRaw) || rateRaw <= 0) return {};
        return {
          exchange_rate: {
            foreign_currency: foreign.toUpperCase(),
            rate: dianAmount(rateRaw),
            date: cur.exchange_rate_date ?? issueAtLocal,
          },
        };
      })(),
      items: lineItems,
      taxes: hasAnyTax ? lineItems.flatMap((l) => l.taxes ?? []) : [],
      notes: notesText,
      order_reference: null,
      resolution_number: resolution.resolution_number,
      technical_key: this.technicalKeyVault.reveal(resolution),
      control: resolveInvoiceControl(resolution, PLATFORM_TIMEZONE, issuedAt, {
        resolution_id: resolution.id,
        document_type: 'sales_invoice',
      }),
      payment_form: dto.payment_form ?? '1',
      payment_means: dto.payment_means_code ?? '42',
      payment_method: null,
    } as unknown as ProviderInvoiceData;
  }

  async retryTransmission(transmissionId: number) {
    const transmission = await this.prisma.withoutScope().fiscal_transmissions.findUnique({
      where: { id: transmissionId },
    });
    if (!transmission) {
      throw new BadRequestException('Fiscal transmission not found');
    }
    if (transmission.transmission_status === 'accepted') {
      throw new BadRequestException('Accepted fiscal transmissions cannot be retried');
    }
    if (transmission.source_type === 'subscription_invoice') {
      return this.issueForInvoice(transmission.source_id, { manual: true, source: 'retry' });
    }
    if (transmission.source_type === 'platform_invoice') {
      return this.resendPlatformTransmission(transmissionId);
    }
    throw new BadRequestException(
      `Retransmisión no soportada para source_type='${transmission.source_type}'`,
    );
  }

  /**
   * Re-firma y re-envía una platform-invoice YA existente. Sin reasignar
   * número: la DIAN quemó el consecutivo en el intento original y no se
   * recupera, así que el `document_number` y `issue_date` del primer intento
   * se preservan (de otra forma el CUFE volvería a calcularse con datos
   * diferentes y la DIAN rechazaría). El snapshot en `fiscal_evidences` con
   * `metadata.kind='platform_invoice_snapshot'` provee el payload original.
   *
   * Si la DIAN rechaza otra vez, `dian_status` queda `'rejected'` y la
   * factura nunca entra al XML firmado — el siguiente paso es la
   * corrección administrativa (anular + nueva factura en otra resolución),
   * NO un tercer retry que tampoco va a pasar.
   */
  async resendPlatformTransmission(transmissionId: number) {
    const settings = await this.getSettings();
    if (!settings.is_enabled) {
      throw new BadRequestException('La facturación de plataforma está desactivada');
    }
    if (!settings.invoice_resolution_id) {
      throw new BadRequestException('La plataforma no tiene una resolución de facturación activa');
    }
    if (!settings.accounting_entity_id) {
      throw new BadRequestException('La plataforma no tiene una entidad contable activa');
    }
    if (!settings.dian_configuration_id) {
      throw new BadRequestException('La plataforma no tiene una configuración DIAN activa');
    }

    return this.runInPlatformContext(settings, async () => {
      const transmission = await this.prisma.withoutScope().fiscal_transmissions.findFirst({
        where: {
          id: transmissionId,
          source_type: 'platform_invoice',
          accounting_entity_id: settings.accounting_entity_id!,
        },
      });
      if (!transmission) {
        throw new BadRequestException('Platform invoice transmission not found');
      }

      // Snapshot persistido en `createPlatformInvoice`. Sin él no
      // podemos reconstruir `ProviderInvoiceData` con el mismo payload
      // del primer intento (el `fiscal_transmissions` no tiene columnas
      // planas para customer / items / totales).
      const snapshot = await this.prisma.withoutScope().fiscal_evidences.findFirst({
        where: {
          fiscal_transmission_id: transmission.id,
          evidence_type: 'manual_support',
        },
        orderBy: { created_at: 'desc' },
      });
      const meta = (snapshot?.metadata as Record<string, unknown> | null) ?? null;
      if (!meta || (meta as any).kind !== 'platform_invoice_snapshot') {
        throw new BadRequestException(
          'No hay snapshot del origen — la factura original no se emitió por createPlatformInvoice.',
        );
      }
      const m: any = meta;
      const customer = m.customer as {
        legal_name: string;
        tax_id: string;
        tax_id_dv: string;
        email?: string;
        address_line?: string;
        city?: string;
        department_code?: string;
      };
      const items = m.items as Array<{
        position: number;
        description: string;
        quantity: number;
        unit_price: number;
        line_total: string;
      }>;
      const totals = m.totals as { subtotal: number; tax_amount: number; total: number };
      const periodStart = (m.period_start as string | null) ?? null;
      const periodEnd = (m.period_end as string | null) ?? null;
      const currency = (m.currency as string) ?? 'COP';

      // Fechas del primer intento: si cambian, el CUFE recalculado ya
      // no matchea el burnt y la DIAN rechaza. La fila trae `created_at`
      // que es el instante del primer CREATE.
      const firstAttemptAt = transmission.created_at ?? new Date();
      const firstAttemptDate = localDateString(firstAttemptAt, PLATFORM_TIMEZONE);
      const firstAttemptTime = localTimeString(firstAttemptAt, PLATFORM_TIMEZONE);
      const firstAttemptDueDate = localDateString(
        new Date(firstAttemptAt.getTime() + 7 * 24 * 60 * 60 * 1000),
        PLATFORM_TIMEZONE,
      );

      // Resolución: la misma que se usó en el primer intento (settings
      // no debería cambiarla entre tanto, pero leemos de la fila por
      // defensa).
      const resolution = await this.prisma.withoutScope().invoice_resolutions.findFirst({
        where: {
          id: settings.invoice_resolution_id!,
          accounting_entity_id: settings.accounting_entity_id!,
          document_type: 'sales_invoice',
        },
      });
      if (!resolution) {
        throw new BadRequestException('No se encontró la resolución original de la factura de plataforma');
      }

      const providerData = {
        invoice_number: transmission.document_number,
        invoice_type: 'sales_invoice',
        issue_date: firstAttemptDate,
        issue_time: firstAttemptTime,
        due_date: firstAttemptDueDate,
        invoice_period: {
          start_date: periodStart ? localDateString(new Date(periodStart), PLATFORM_TIMEZONE) : firstAttemptDate,
          end_date: periodEnd ? localDateString(new Date(periodEnd), PLATFORM_TIMEZONE) : firstAttemptDate,
        },
        customer_name: customer.legal_name,
        customer_tax_id: customer.tax_id,
        customer_email: customer.email ?? null,
        customer_address: customer.address_line
          ? {
              line: customer.address_line,
              city: customer.city ?? null,
              department_code: customer.department_code ?? null,
              country_code: 'CO',
            }
          : null,
        customer_document_type: '31',
        customer_verification_digit: customer.tax_id_dv ?? null,
        customer_person_type: '2',
        customer_regime: '49',
        customer_tax_responsibilities: ['O-13'],
        subtotal_amount: Number(totals.subtotal ?? 0).toFixed(2),
        discount_amount: '0.00',
        tax_amount: Number(totals.tax_amount ?? 0).toFixed(2),
        withholding_amount: '0.00',
        total_amount: Number(totals.total ?? 0).toFixed(2),
        currency,
        items,
        taxes: [],
        notes: [
          `Factura de servicios generada desde super-admin el ${firstAttemptDate}`,
          'Servicio excluido de IVA — art. 476 num. 21 del Estatuto Tributario',
          `(retry) ${localDateString(new Date(), PLATFORM_TIMEZONE)} ${localTimeString(new Date(), PLATFORM_TIMEZONE)}`,
        ].join('\n'),
        order_reference: null,
        resolution_number: resolution.resolution_number,
        technical_key: this.technicalKeyVault.reveal(resolution),
        control: resolveInvoiceControl(resolution, PLATFORM_TIMEZONE, firstAttemptAt, {
          resolution_id: resolution.id,
          document_type: 'sales_invoice',
        }),
        payment_form: '1',
        payment_means: '42',
        payment_method: null,
      } as unknown as ProviderInvoiceData;

      // No se reescribe `request_hash`: el primer intento ya lo dejó
      // firmado. Bump de `retry_count` ocurre implícitamente al
      // `markSubmitted` (que también pone sent_at al NOW real del retry).
      await this.markSubmitted(transmission.id);

      try {
        const response = await this.dianProvider.sendInvoice(providerData);
        if (response.success) {
          await this.markAccepted(transmission.id, response);
        } else {
          await this.markRejected(transmission.id, response);
        }
      } catch (error) {
        await this.markError(transmission.id, error);
        throw error;
      }

      const final = await this.prisma.withoutScope().fiscal_transmissions.findUnique({
        where: { id: transmission.id },
      });

      return {
        transmission_id: transmission.id,
        fiscal_number: final?.document_number ?? transmission.document_number,
        transmission_status: final?.transmission_status ?? 'unknown',
        dian_status: final?.dian_status ?? 'unknown',
        cufe: final?.cufe ?? null,
      };
    });
  }

  /**
   * C.11: crea una factura personalizada de plataforma. A diferencia de
   * `issueForInvoice` (que firma una `subscription_invoice` ya existente),
   * este método arma la `fiscal_transmission` con `source_type='platform_invoice'`
   * sin crear una `subscription_invoices` auxiliar. Cubre los servicios
   * que Vendix cobra a sus tenants sin pasar por el motor de
   * suscripciones: implementación, consultoría, capacitación.
   *
   * El número se asigna con la misma `allocateFiscalNumber` que las
   * suscripciones usan. La idempotency_key se deriva del `idempotency_hint`
   * que el cliente pasa (si lo da) o de un uuid generado server-side:
   * dos requests con la misma key no emiten dos facturas.
   */
  async createPlatformInvoice(dto: CreatePlatformInvoiceDto): Promise<{
    invoice_id: number;
    fiscal_number: string;
    transmission_id: number;
    transmission_status: string;
    dian_status: string;
    cufe: string | null;
  }> {
    const settings = await this.getSettings();
    if (!settings.is_enabled) {
      throw new BadRequestException('La facturación de plataforma está desactivada');
    }
    if (!settings.invoice_resolution_id) {
      throw new BadRequestException('La plataforma no tiene una resolución de facturación activa');
    }
    if (!settings.accounting_entity_id) {
      throw new BadRequestException('La plataforma no tiene una entidad contable activa');
    }
    if (!settings.dian_configuration_id) {
      throw new BadRequestException('La plataforma no tiene una configuración DIAN activa');
    }

    // 0) Validaciones previas. Mismas que `issueForInvoice` corre para
    //    suscripciones: si falta un dato fiscal del destinatario o la
    //    prevalidación falla, NO quemamos consecutivo. El 17/08 esto costó
    //    el rechazo de la primera factura de suscripción emitida.
    if (!dto.customer.legal_name?.trim()) {
      throw new BadRequestException('El destinatario requiere legal_name');
    }
    if (!/^\d+$/.test(dto.customer.tax_id)) {
      throw new BadRequestException('El destinatario requiere tax_id numérico');
    }
    // DV exigido SÓLO cuando el documento es NIT (Anexo Técnico 19, DIAN).
    // Cédula (13), Cédula de Extranjería (22) y Pasaporte (41) NO llevan DV:
    // el selector del frontend ya las distingue, y exigir DV rompe un caso
    // real (facturar a persona natural). El default del lado del servicio
    // sigue siendo '31' porque `document_type` todavía no fluye desde el
    // DTO V1 (bloqueador en PlatformInvoiceTenantRefDto) — cuando sume el
    // campo, este bloque ya está listo para leerlo.
    const customerDocumentType = dto.customer.document_type ?? '31';
    const isNit =
      customerDocumentType === '31' || customerDocumentType === 'NIT';
    if (
      isNit &&
      !/^\d$/.test(dto.customer.tax_id_dv ?? '')
    ) {
      throw new BadRequestException(
        'El destinatario requiere DV (NIT, tipo 31): un solo dígito numérico.',
      );
    }
    if (dto.items.length === 0) {
      throw new BadRequestException('La factura debe tener al menos una línea');
    }
    for (const [i, item] of dto.items.entries()) {
      if (!item.description?.trim()) {
        throw new BadRequestException(`Línea ${i + 1}: descripción requerida`);
      }
      if (!(Number(item.quantity) > 0) || !(Number(item.unit_price) >= 0)) {
        throw new BadRequestException(`Línea ${i + 1}: cantidad > 0 y precio ≥ 0`);
      }
    }

    return this.runInPlatformContext(settings, async () => {
      const issuedAt = new Date();
      const issuedAtLocal = localDateString(issuedAt, PLATFORM_TIMEZONE);
      const issuedAtTime = localTimeString(issuedAt, PLATFORM_TIMEZONE);
      // due_date: el caller puede sobreescribirla (DTO). Default legacy:
      // emisión + 7 días. ISO8601 → YYYY-MM-DD local.
      const dueAt = dto.due_date
        ? localDateString(new Date(dto.due_date), PLATFORM_TIMEZONE)
        : localDateString(
            new Date(issuedAt.getTime() + 7 * 24 * 60 * 60 * 1000),
            PLATFORM_TIMEZONE,
          );
      // issue_date: idem, default = emisión.
      const issueAtLocal = dto.issue_date
        ? localDateString(new Date(dto.issue_date), PLATFORM_TIMEZONE)
        : issuedAtLocal;

      // 0.b) Cálculo por línea. Construye `lineItems` (forma que firma la
      //     DIAN) Y `snapshotItems` (forma del snapshot contable que lee el
      //     listener de auto-asientos vía `loadInvoiceSnapshot`).
      //
      //     Regla de cuadre FAS02 (peer rule 3): `tax_amount` de cabecera
      //     es SIEMPRE la suma de los impuestos por línea — NUNCA base×tarifa
      //     recalculada sobre el subtotal. Recalcular da un céntimo de
      //     diferencia y lo rechaza la DIAN.
      //
      //     Regla de impuesto incluido (peer rule 4): cuando una línea trae
      //     `taxes[].is_inclusive=true`, su base gravable es
      //     `neto / (1 + Σ tarifas_inclusivas)`. Cada impuesto exclusivo
      //     usa esa misma base despejada. El frontend manda `rate` en
      //     fracción 0–1.
      //
      //     Backward compat (peer rule 2): si NINGUNA línea trae `taxes`,
      //     `tax_amount = 0` y se conserva la nota de exclusión art. 476
      //     num. 21 ET. Si AL MENOS una línea trae `taxes`, la nota de
      //     exclusión NO se emite (sería una declaración falsa) y la
      //     cabecera lleva `taxes[]`.
      let hasAnyTax = false;
      let totalTaxAmount = 0;
      const lineItems: any[] = [];
      const snapshotItems: any[] = [];

      for (let i = 0; i < dto.items.length; i++) {
        const item = dto.items[i];
        const qty = Number(item.quantity);
        const price = Number(item.unit_price);
        const discount = Number(item.discount_amount ?? 0);
        // Redondeo POR LÍNEA, después suma. Coincide con la convención
        // `LineExtensionAmount` de la DIAN; una suma de floats sin
        // redondeo intermedio puede dar FAU04 al cuadrar con
        // TaxExclusiveAmount.
        const gross = Math.round((qty * price - discount) * 100) / 100;

        const taxes = Array.isArray(item.taxes) ? item.taxes : [];
        const inclusiveRateSum = taxes
          .filter((t) => t.is_inclusive === true)
          .reduce((acc, t) => acc + Number(t.rate || 0), 0);

        let lineBaseForExclusiveTaxes: number;
        let lineBaseForInclusiveTaxes: number;
        if (inclusiveRateSum > 0) {
          // gross = base * (1 + Σ inclusive). Despejamos.
          lineBaseForInclusiveTaxes = Math.round((gross / (1 + inclusiveRateSum)) * 100) / 100;
          // La base para exclusivos comparte el mismo neto despejado: ambos
          // tipos tributan sobre el valor sin impuesto (post-disc, pre-tax).
          lineBaseForExclusiveTaxes = lineBaseForInclusiveTaxes;
        } else {
          lineBaseForExclusiveTaxes = gross;
          lineBaseForInclusiveTaxes = gross;
        }

        const providerTaxes: any[] = [];
        const taxBreakdownSnapshot: any[] = [];
        let lineTaxTotal = 0;
        for (const tax of taxes) {
          const rate = Number(tax.rate || 0);
          if (rate <= 0) continue;
          // El frontend PUEDE mandar `tax_amount` calculado, pero un navegador
          // es un origen que se puede manipular: si el monto que inyecta no
          // cuadra con `base × tarifa`, la DIAN lo rechaza con FAS02 firmando
          // con NUESTRO certificado. El monto que va al XML sale SIEMPRE de
          // nuestro cálculo sobre la base despejada; el del cliente, si llega,
          // se descarta (peer rule de vendix-db).
          let taxAmount: number;
          if (tax.is_inclusive) {
            taxAmount = Math.round(lineBaseForInclusiveTaxes * rate * 100) / 100;
          } else {
            taxAmount = Math.round(lineBaseForExclusiveTaxes * rate * 100) / 100;
          }
          lineTaxTotal += taxAmount;
          providerTaxes.push({
            tax_type: tax.tax_type,
            tax_name: tax.tax_type, // el mapper legacy renombra según enum
            rate: tax.is_inclusive ? rate : rate,
            // `is_inclusive` no es un campo del provider: el provider modela
            // un único `rate`. La fachada legacy convierte inclusivos a
            // exclusivos antes de firmar; acá sólo propagamos los datos
            // necesarios para que el mapper haga esa conversión.
            taxable_amount: tax.taxable_amount ?? null,
            tax_amount: taxAmount.toFixed(2),
            is_inclusive: !!tax.is_inclusive,
          });
          taxBreakdownSnapshot.push({
            tax_type: tax.tax_type,
            rate,
            tax_amount: taxAmount,
            is_inclusive: !!tax.is_inclusive,
            taxable_amount: tax.taxable_amount ?? null,
          });
          hasAnyTax = true;
        }

        // Default unit_code: 'NIU' (UN/ECE Rec. 20). 'EA' no está en la rec.
        // y ningún selector del front lo puede pintar — el legacy lo
        // hardcodeaba por bug histórico.
        const unit_code = item.unit_code ?? 'NIU';

        lineItems.push({
          position: i + 1,
          description: item.description,
          quantity: qty,
          unit_price: price,
          line_total: gross.toFixed(2),
          // Si la línea no trae descuento lo emitimos como 0 explícito
          // para que el snapshot refleje el cálculo real; si lo trae, fluye.
          discount_amount: discount.toFixed(2),
          item_code: null,
          unit_code,
          // `omit_tax_total: true` SÓLO cuando la línea no trae taxes (legacy).
          // Con taxes presentes la línea SÍ tributa y la DIAN debe incluirla
          // en TaxSubtotal.
          omit_tax_total: taxes.length === 0,
          // Si la línea trae taxes, propagamos al provider; el mapper los
          // aplana al array `taxes` de cabecera. Si NO trae taxes, no
          // emitimos `taxes` por línea — el legacy así lo hacía.
          ...(taxes.length > 0 ? { taxes: providerTaxes } : {}),
        });

        snapshotItems.push({
          position: i + 1,
          description: item.description,
          quantity: qty,
          unit_price: price,
          line_total: gross,
          discount_amount: discount,
          unit_code,
          taxes: taxBreakdownSnapshot,
          // Peer rule: cuenta PUC de ingreso por línea. Si falta, queda
          // null en el snapshot; el listener cae al mapping legacy
          // `invoice.validated.revenue`.
          account_code: item.account_code ?? null,
          // Para asiento multi-crédito futuro: la línea PUEDE llevar
          // también un centro de costo / descripción adicional, pero el
          // DTO V1 no lo trae — se omite.
        });

        totalTaxAmount += lineTaxTotal;
      }

      const subtotal =
        Math.round(lineItems.reduce((acc, l) => acc + Number(l.line_total), 0) * 100) / 100;
      const taxAmount = Math.round(totalTaxAmount * 100) / 100;
      const total = Math.round((subtotal + taxAmount) * 100) / 100;

      // Withholdings: suman al campo withholding_amount del provider (asset
      // debit en el listener — ver onInvoiceValidated caso 2). Si el caller
      // no envía, queda `[]` y el campo se emite en 0.
      //
      // `rate` llega en FRACCIÓN 0..1 desde el DTO (elon NO divide por 100);
      // la conversión a porcentaje la hace el provider UNA sola vez al firmar
      // el XML. Acá sólo calculamos `amount` para `withholding_amount`, sin
      // confiar en lo que mande el cliente — mismo razonamiento que para
      // `tax_amount`: un navegador se puede manipular.
      const withholdings = Array.isArray(dto.withholdings) ? dto.withholdings : [];
      const withholdingAmount = withholdings.reduce((acc, w) => {
        const base = Number(w.base_amount) || 0;
        const rate = Number(w.rate) || 0;
        return acc + Math.round(base * rate * 100) / 100;
      }, 0);

      // 0.c) Idempotencia por contenido. Doble click en el botón =
      //     mismo tax_id + mismas items + mismo período → misma key.
      //     Peer rule 7: con impuestos y retenciones variables, dos
      //     facturas que difieren sólo en la tarifa colisionarían.
      //     Sumamos `taxes`, `withholdings` y `total` al hash.
      //     La UNIQUE (accounting_entity_id, document_type, idempotency_key)
      //     en fiscal_transmissions rechaza la segunda.
      const idempotencyKey = this.hash({
        kind: 'platform_invoice',
        tax_id: dto.customer.tax_id,
        items: lineItems,
        period_start: dto.period_start ?? null,
        period_end: dto.period_end ?? null,
        // peer rule 7
        taxes: lineItems.flatMap((l) => l.taxes ?? []),
        withholdings,
        total,
        counterpart_account_code: dto.counterpart_account_code ?? null,
        resolution_id: dto.resolution_id ?? null,
      });

      // 0.d) F4 (auditoría vendix-db) — pre-validadores ANTES de
      //      `allocateFiscalNumber`. Lo que el riel de suscripción corre en
      //      `evaluateEmitReadiness` (42 reglas de identidad + documento) y
      //      que el riel de tienda corre como compuerta dura, hoy saltaba
      //      acá: el documento se creaba y la transmisión quedaba huérfana
      //      con la numeración ya quemada, mientras que los bloqueos aparecían
      //      recién en `UblStructureValidator`/`DianTotalsValidator` — en la
      //      compuerta de totales, con la fila ya persistida.
      //
      //      Mismo suelo que `allocateFiscalNumber` (`range_from - 1`,
      //      `cursor = max(current_number, floor)`): sin nivelar, una
      //      resolución cuyo cursor derivó a 0 sondearía el número 1 y
      //      la regla de rango denunciaría un falso positivo que la
      //      asignación real ya corrige.
      const probeResolution = await this.prisma
        .withoutScope()
        .invoice_resolutions.findFirst({
          where: {
            id: dto.resolution_id ?? settings.invoice_resolution_id!,
            accounting_entity_id: settings.accounting_entity_id!,
            document_type: 'sales_invoice',
            is_active: true,
            valid_from: { lte: new Date() },
            valid_to: { gte: new Date() },
          },
        });
      if (!probeResolution) {
        throw new BadRequestException(
          'No hay una resolución de numeración activa para ventas (sales_invoice) ' +
            'que coincida con la entidad contable y la ventana de vigencia actuales.',
        );
      }
      const probeFloor = probeResolution.range_from - 1;
      const probeCursor =
        probeResolution.current_number < probeFloor
          ? probeFloor
          : probeResolution.current_number;
      const probeNumber = `${probeResolution.prefix}${probeCursor + 1}`;

      // Construimos el providerData con el número de SONDEO. Mismos
      // items/totals/taxes/withholdings que la versión final — el `invoice_number`
      // y el `control` son los únicos campos que pueden cambiar entre el
      // sondeo y la asignación real (un proceso concurrente podría consumir
      // un número entre el `findFirst` y el `pg_advisory_xact_lock`). Después
      // de `allocateFiscalNumber` re-armamos el providerData con los valores
      // reales, dentro de la tx.
      //
      // `notesText` se calcula acá (no dentro de la tx) porque la rama
      // pre-validadora no necesita la tx para nada: corre contra el snapshot
      // del sondeo. Si la nota cambia entre sondeo y final —no puede, sale
      // sólo del DTO y de los totales locales, todos inmutables entre los dos
      // puntos— el providerData real lo recalcula dentro de la tx.
      const defaultNotes = hasAnyTax
        ? [`Factura de servicios generada desde super-admin el ${issueAtLocal}`]
        : [
            `Factura de servicios generada desde super-admin el ${issueAtLocal}`,
            'Servicio excluido de IVA — art. 476 num. 21 del Estatuto Tributario',
          ];
      const notesText = dto.notes ?? defaultNotes.join('\n');

      const probeProviderData = this.buildPlatformProviderData(
        dto,
        probeNumber,
        probeResolution,
        issuedAt,
        issuedAtTime,
        dueAt,
        issueAtLocal,
        lineItems,
        subtotal,
        taxAmount,
        total,
        withholdingAmount,
        hasAnyTax,
        notesText,
      );

      const blockers: Array<{ code: string; problem: string; field?: string }> = [];
      const identityInput = this.buildPlatformCustomerIdentityInput(dto);
      const identityFindings = this.identityValidator.validate(identityInput);
      for (const f of identityFindings.findings) {
        if (f.severity === 'blocker') {
          blockers.push({
            code: f.code,
            field: f.field,
            problem: `Identidad del adquiriente: ${f.problem}`,
          });
        }
      }
      const documentFindings = this.documentValidator.validate(
        this.buildFiscalDocumentInput(probeProviderData, probeResolution),
      );
      for (const f of documentFindings.findings) {
        if (f.severity === 'blocker') {
          blockers.push({
            code: f.code,
            field: f.field,
            problem: `Documento: ${f.problem}`,
          });
        }
      }
      if (blockers.length > 0) {
        throw new BadRequestException({
          message:
            'La factura no se puede emitir todavía: hay validaciones de pre-emisión que fallaron. ' +
            'Corregí los puntos siguientes antes de reintentar.',
          blockers,
        });
      }

      // 1) TODO dentro de UNA transacción. `pg_advisory_xact_lock` se
      //    libera al COMMIT, no antes. Si la llamada anterior era
      //    `await this.prisma.$transaction(async (tx) => tx)`, el
      //    `tx` ya hizo COMMIT y la siguiente query (el SELECT FOR
      //    UPDATE del lock) recibe P2028. La memoria del proyecto
      //    documenta esto en `prisma_transaction_returns_committed_handle`.
      const result = await this.prisma.$transaction(async (tx) => {
        // 1.a) Asignar número con el lock consultivo.
        const allocated = await this.allocateFiscalNumber(tx, settings, dto.resolution_id);
        const fiscalNumber = allocated.invoice_number;
        const resolution = allocated.resolution;

        // 1.b) Re-construir el providerData con los valores REALES. El
        //      `probeProviderData` se construyó fuera de la tx para que los
        //      pre-validadores (F4) lo vieran; sólo difieren `invoice_number`
        //      y `control` (resolución que efectivamente dio el número bajo
        //      `pg_advisory_xact_lock`). Re-armarlo es más barato que
        //      mutar campo por campo y deja el código idéntico al que el riel
        //      tienda esperaba.
        const providerData = this.buildPlatformProviderData(
          dto,
          fiscalNumber,
          resolution,
          issuedAt,
          issuedAtTime,
          dueAt,
          issueAtLocal,
          lineItems,
          subtotal,
          taxAmount,
          total,
          withholdingAmount,
          hasAnyTax,
          notesText,
        );

        // 1.c) Insertar la fila. Si la idempotency_key ya existe, el
        // UNIQUE la rechaza y devolvemos la fila existente — el caller
        // ve la misma respuesta que la primera.
        let transmission;
        try {
          transmission = await tx.fiscal_transmissions.create({
            data: {
              organization_id: settings.platform_organization_id!,
              store_id: null,
              accounting_entity_id: settings.accounting_entity_id!,
              dian_configuration_id: settings.dian_configuration_id!,
              source_type: 'platform_invoice',
              source_id: 0,
              document_type: 'sales_invoice',
              document_number: fiscalNumber,
              transmission_status: 'queued',
              dian_status: 'pending',
              accounting_status: 'provisional',
              idempotency_key: idempotencyKey,
              request_hash: this.hash(providerData),
            },
          });
        } catch (error: any) {
          if (error?.code === 'P2002') {
            // Idempotencia: la UNIQUE (accounting_entity_id,
            // document_type, idempotency_key) rechazó. Devolvemos la
            // fila existente. La transacción sigue para que el lock
            // se libere al COMMIT.
            const existing = await tx.fiscal_transmissions.findFirst({
              where: {
                accounting_entity_id: settings.accounting_entity_id!,
                document_type: 'sales_invoice' as const,
                idempotency_key: idempotencyKey,
              },
            });
            if (existing) {
              transmission = existing;
            } else {
              throw error;
            }
          } else {
            throw error;
          }
        }

        // 1.d) Snapshot del origen. El frontend navega a `/invoices/:id`
        //     usando `transmission.id` como id (la UNIQUE del cursor es la
        //     pieza de identidad que el operador reconoce). Como
        //     `fiscal_transmissions` no tiene columnas planas para
        //     customer / items / totales, persistimos una fila en
        //     `fiscal_evidences` con `metadata.kind='platform_invoice_snapshot'`
        //     y el payload dentro. El detail endpoint la lee para
        //     sintetizar la misma shape que `subscription_invoices`
        //     devuelve al otro lado del endpoint.
        //
        //     Usamos `manual_support` como evidence_type porque ya
        //     existe en el enum y no requiere migración: el snapshot es
        //     semánticamente un "documento de soporte interno" que
        //     respalda el documento fiscal. La lectura al detalle es por
        //     `metadata.kind`, no por `evidence_type`.
        //
        //     peer rule 6 — el metadata AHORA lleva `counterpart_account_code`,
        //     `resolution_id`, `issue_date` y `account_code` dentro de cada
        //     item para que `emitInvoiceAccepted` los pueda releer sin
        //     recalcular.
        await tx.fiscal_evidences.create({
          data: {
            organization_id: settings.platform_organization_id!,
            store_id: null,
            accounting_entity_id: settings.accounting_entity_id!,
            fiscal_transmission_id: transmission.id,
            evidence_type: 'manual_support',
            storage_key: null,
            content_hash: idempotencyKey,
            metadata: {
              kind: 'platform_invoice_snapshot',
              customer: dto.customer,
              items: snapshotItems,
              totals: { subtotal, tax_amount: taxAmount, total },
              period_start: dto.period_start ?? null,
              period_end: dto.period_end ?? null,
              currency: dto.currency ?? 'COP',
              withholdings: withholdings.map((w) => ({
                role: w.role,
                concept_id: w.concept_id,
                base_amount: Number(w.base_amount),
                rate: Number(w.rate),
                amount: w.amount != null ? Number(w.amount) : Math.round(Number(w.base_amount) * Number(w.rate) * 100) / 100,
              })),
              counterpart_account_code: dto.counterpart_account_code ?? null,
              resolution_id: resolution.id,
              issue_date: issueAtLocal,
              created_by: 'createPlatformInvoice',
            },
          },
        });

        return { transmission, providerData, resolution };
      });

      const { transmission, providerData, resolution } = result;

      // 2) Firmar y transmitir FUERA de la tx. `markSubmitted` y la
      //    llamada al provider SOAP ya hicieron COMMIT del lock; las
      //    escrituras a `fiscal_transmissions` post-firma son updates
      //    sobre la fila ya persistida.
      await this.markSubmitted(transmission.id);

      try {
        const response = await this.dianProvider.sendInvoice(providerData);
        if (response.success) {
          await this.markAccepted(transmission.id, response);
        } else {
          await this.markRejected(transmission.id, response);
        }
      } catch (error) {
        await this.markError(transmission.id, error);
        throw error;
      }

      const final = await this.prisma.withoutScope().fiscal_transmissions.findUnique({
        where: { id: transmission.id },
      });

      return {
        invoice_id: transmission.id,
        transmission_id: transmission.id,
        fiscal_number: final?.document_number ?? '',
        transmission_status: final?.transmission_status ?? 'unknown',
        dian_status: final?.dian_status ?? 'unknown',
        cufe: final?.cufe ?? null,
      };
    });
  }



  /**
   * Barre todas las facturas SaaS en estado `paid` que NO tienen una transmisión
   * aceptada, y llama a `issueForInvoice` con `manual: true, source: 'sweep'`.
   *
   * Justificación: `auto_issue` solo cubre pagos futuros. Una factura pagada
   * cuya emisión falló por un motivo transitorio quedaba sin emitir para siempre
   * (el listener no reintenta). El endpoint permite disparar la recuperación
   * desde un cron externo o a mano, sin agregar cron jobs al backend.
   *
   * Idempotencia: `issueForInvoice` usa `idempotency_key` por transmisión, así
   * que la segunda corrida del sweep siempre devuelve `picked_up: 0` salvo que
   * haya un nuevo pago en estado `paid` sin transmisión aceptada.
   */
  async sweepPendingInvoices(): Promise<{
    picked_up: number;
    succeeded: number;
    rejected: number;
    errored: number;
    skipped: number;
    failed: { invoice_id: number; code: string; summary: string }[];
  }> {
    // El barrido DEBE correr dentro del contexto de plataforma. Si lo dispara
    // un cron sin un JWT que setee `RequestContextService`, las queries
    // previas a `issueForInvoice` aquí y el `sendInvoice` interno de la DIAN
    // fallarían por NPE en `getSettings()`/`platform_organization_id`.
    //
    // Capturamos `environment` al inicio: si la plataforma cambia de test a
    // production a mitad del barrido, abortamos. Mezclar facturas emitidas
    // a sandbox y a producción en el mismo run rompe paridad.
    const settings = await this.getSettings();
    const environmentAtStart = settings.environment;
    return this.runInPlatformContext(settings, async () => {
      const rows = await this.prisma.withoutScope().subscription_invoices.findMany({
        where: {
          state: 'paid',
          // El barrido SOLO recorre facturas de la entidad contable de la
          // plataforma. Si una `subscription_invoice` pertenece a otra entidad
          // fiscal, debe barrerse desde el servicio de ESA entidad, no
          // desde este carrusel — caso contrario, `issueForInvoice` la
          // firmaría con la resolución incorrecta.
          store_subscription: {
            store: {
              organizations: {
                accounting_entities: {
                  some: {
                    // F-R2-3: si `settings.accounting_entity_id` es null
                    // (entidad plataforma no configurada), la cláusula
                    // matchea 0 filas — el sweep retorna `picked_up: 0`
                    // en vez de fallar. El operador debe configurar
                    // la identidad antes de invocar el sweep.
                    id: settings.accounting_entity_id ?? -1,
                    is_active: true,
                  },
                },
              },
            },
          },
        },
        orderBy: { created_at: 'asc' }, // oldest-first: los pendientes más atrasados primero
        select: { id: true },
        // Cota dura: 15 facturas × 2-3 s/issue a la DIAN = 30-45 s, dentro
        // del `proxy_read_timeout` 60 s de nginx en producción. Si quedan
        // pendientes, el operador vuelve a invocar el endpoint. La idempotency
        // key de `fiscal_transmissions` hace la segunda corrida no-op para
        // las ya procesadas.
        take: 15,
      });

      // F-R2-3: si el listener de pagos corre en paralelo con el sweep, los
      // dos pueden leer la misma `subscription_invoices` con `state='paid'`
      // y entrar ambos a `issueForInvoice`. El `idempotency_key` los
      // distingue en `fiscal_transmissions` pero el segundo todavía
      // emitiría un SOAP request inútil. Con `FOR UPDATE SKIP LOCKED`
      // PostgreSQL deja cada invoice en manos de un solo worker — el resto
      // se salta y los procesa la siguiente corrida.
      //
      // Sólo aplicamos el lock a las ids que ya pasaron el filtro de
      // `accounting_entity_id` (el `findMany` anterior). Sin SKIP LOCKED,
      // la segunda sweep que corre en paralelo BLOQUEARÍA hasta que la
      // primera termine; con SKIP LOCKED, simplemente no toma esa fila
      // y procesa la siguiente que esté libre.
      if (rows.length > 0) {
        // F-R2-3: con `FOR UPDATE SKIP LOCKED` las facturas que otro
        // worker (listener de pagos) ya está procesando se saltan, y la
        // primera sweep gana el lock. Usamos `$queryRawUnsafe` porque el
        // `GlobalPrismaService` no expone `$queryRaw` tipado.
        const ids = rows.map((r) => r.id);
        const idsLiteral = `{${ids.join(',')}}`;
        const lockedRows = await this.prisma
          .withoutScope()
          .$queryRawUnsafe<Array<{ id: number }>>(
            `SELECT id FROM subscription_invoices WHERE id = ANY($1::int[]) ORDER BY paid_at ASC NULLS LAST FOR UPDATE SKIP LOCKED`,
            idsLiteral,
          );
        rows.length = 0;
        rows.push(...lockedRows.map((r) => ({ id: r.id })));
      }

      // F-R2-8: excluir invoices cuya transmisión ya se intentó
      // `MAX_RETRIES` veces. Sin este guard, el sweep re-envía la misma
      // factura rechazada indefinidamente. La DIAN suele responder
      // `Regla: 90 — Documento repetido` por 24h si el CUFE ya existe,
      // así que insistir empeora el rate-limit.
      const MAX_RETRIES = 5;
      if (rows.length > 0) {
        const exhausted = await this.prisma.withoutScope().fiscal_transmissions.findMany({
          where: {
            source_type: 'subscription_invoice',
            source_id: { in: rows.map((r) => r.id) },
            retry_count: { gte: MAX_RETRIES },
            transmission_status: { notIn: ['accepted', 'cancelled'] },
          },
          select: { source_id: true },
        });
        const exhaustedSet = new Set(exhausted.map((t) => t.source_id));
        const filtered = rows.filter((r) => !exhaustedSet.has(r.id));
        rows.length = 0;
        rows.push(...filtered);
        if (exhaustedSet.size > 0) {
          this.logger.warn(
            `Subscription fiscal sweep: ${exhaustedSet.size} invoice(s) excluidas por retry_count >= ${MAX_RETRIES}`,
          );
        }
      }

      const accepted = await this.prisma.withoutScope().fiscal_transmissions.findMany({
        where: {
          source_type: 'subscription_invoice',
          dian_status: 'accepted',
          source_id: { in: rows.map((r) => r.id) },
        },
        select: { source_id: true },
      });
      const acceptedSet = new Set(accepted.map((t) => t.source_id));
      const pending = rows.filter((r) => !acceptedSet.has(r.id));

      const result = {
        picked_up: pending.length,
        succeeded: 0,
        rejected: 0,
        errored: 0,
        skipped: 0,
        // F-R2-7: el `reason` original era `error.message` raw. Ese string
        // puede incluir paths internos, IDs de transmisión, NITs del
        // destinatario y la respuesta cruda de la DIAN. Lo categorizamos
        // en un `code` estable y un `summary` redactado para que el
        // operador sepa qué pasó sin filtrar PII accidentalmente. El
        // detalle real vive en `fiscal_transmissions.error_message`
        // (server-side) y en el log.
        failed: [] as { invoice_id: number; code: string; summary: string }[],
      };

      // F-R2-18: cap defensivo del array `failed[]` para que un sweep
      // con 200 fallos no devuelva 200 entradas al caller (cada una con
      // invoice_id, code, summary). Con MAX_FAILED_ENTRIES=50, un sweep
      // con `total_failed > 50` requiere re-invocar el endpoint; el
      // `total_failed` exterior sigue contando todos.
      const MAX_FAILED_ENTRIES = 50;

      for (const { id } of pending) {
        // Congelar ambiente: si cambió durante el barrido, abortamos.
        const current = await this.getSettings();
        if (current.environment !== environmentAtStart) {
          this.logger.warn(
            `Subscription fiscal sweep aborted: environment changed from ${environmentAtStart} to ${current.environment} mid-run`,
          );
          result.failed.push({
            invoice_id: id,
            code: 'ENVIRONMENT_CHANGED',
            summary: `ambiente cambió a mitad del barrido (de ${environmentAtStart} a ${current.environment})`,
          });
          break;
        }
        const isFailedEntryCapped = result.failed.length >= MAX_FAILED_ENTRIES;
        try {
          const r = await this.issueForInvoice(id, { manual: true, source: 'sweep' });
          // `issueForInvoice` retorna una `fiscal_transmissions` (ruta
          // exitosa) o `{skipped, reason}` (ruta omitida). El compilador
          // no unifica el tipo; casteamos para discriminar.
          const skipped = (r as any)?.skipped === true;
          if (skipped) {
            result.skipped += 1;
          } else {
            // `issueForInvoice` retorna la fila recargada en la ruta exitosa.
            // Distinguimos entre el éxito real (accepted) y los fallos que
            // captura internamente (rejected/error) para que el operador no
            // confunda "se procesó" con "quedó emitida".
            const status = (r as any)?.transmission_status;
            const dian = (r as any)?.dian_status;
            if (status === 'accepted' || dian === 'accepted') {
              result.succeeded += 1;
            } else if (status === 'rejected') {
              result.rejected += 1;
            } else if (status === 'error') {
              result.errored += 1;
            } else if (!isFailedEntryCapped) {
              result.failed.push({
                invoice_id: id,
                code: 'UNEXPECTED_TERMINAL_STATUS',
                summary: `estado terminal inesperado: ${status ?? 'unknown'}`,
              });
            }
          }
        } catch (error) {
          // Categorizamos el error en códigos estables. El mensaje crudo va
          // al log (server-side), no a la respuesta.
          this.logger.warn(
            `Subscription fiscal sweep failed invoice=${id}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          const isVendixEx = error && typeof error === 'object' && 'code' in error;
          if (!isFailedEntryCapped) {
            result.failed.push({
              invoice_id: id,
              code: isVendixEx ? 'PREVALIDATION_FAILED' : 'INTERNAL_ERROR',
              summary: 'la DIAN rechazó la transmisión o el sistema falló; ver log server-side',
            });
          }
        }
      }

      this.logger.log(
        `Subscription fiscal sweep: picked_up=${result.picked_up} succeeded=${result.succeeded} rejected=${result.rejected} errored=${result.errored} skipped=${result.skipped} failed=${result.failed.length}`,
      );

      // F-R2-10: persistimos un `audit_logs` row para que la operación
      // quede registrada en el log inmutable. La acción `fiscal.sweep`
      // permite buscar sweeps por usuario; el `new_values` lleva el
      // resumen. `actor_user_id` lo extraemos del RequestContextService
      // (puede ser null si el sweep lo dispara un cron sin JWT).
      const actorUserId = RequestContextService.getUserId() ?? null;
      await this.prisma.withoutScope().audit_logs.create({
        data: {
          user_id: actorUserId,
          action: 'fiscal.sweep',
          resource: 'subscription_fiscal',
          resource_id: null,
          organization_id: settings.platform_organization_id ?? null,
          new_values: {
            picked_up: result.picked_up,
            succeeded: result.succeeded,
            rejected: result.rejected,
            errored: result.errored,
            skipped: result.skipped,
            failed: result.failed.length,
            failed_capped: result.failed.length >= MAX_FAILED_ENTRIES,
            environment: environmentAtStart,
          } as any,
        },
      });

      return result;
    });
  }

  /**
   * Detalle de UNA factura SaaS para mostrar en super-admin. Reune la factura
   * SaaS, su(s) transmisión(es) DIAN y las evidencias (XML firmado, PDF, QR,
   * respuesta DIAN) en un payload que la vista de plataforma consume sin tener
   * que volver a preguntar al backend.
   *
   * Retorna `null` si la factura no existe. NO verifica que pertenezca a la
   * organización plataforma: con `accounting_entity_id` derivado en build, una
   * factura SaaS siempre va a tener la entidad correcta — pero la factura
   * huérfana (sin transmisión todavía) se considera "no emitida" y se devuelve
   * con `transmission: null` + `evidences: []`.
   */
  /**
   * Detalle de una plataforma invoice. Se expone en ruta separada
   * (`GET /platform-invoices/:id`, no `/invoices/:id`) para que el id
   * numérico apunte sin ambigüedad: `subscription_invoices.id` y
   * `fiscal_transmissions.id` son secuencias independientes y, en caso
   * de colisión numérica, una sola ruta desambigua por source_type sin
   * tener que inferir. Sin discriminar, abrir `/invoices/42` cuando
   * existe un SaaS invoice #42 devolvería la platform-invoice si el
   * probe de transmisión casaba primero — sin fuga de datos (filtra por
   * entidad contable) pero mostrando el documento equivocado.
   *
   * Lee el snapshot persistido en `fiscal_evidences` por
   * `createPlatformInvoice` y sintetiza la misma shape que el rail SaaS,
   * para no romper la plantilla del detail component.
   */
  async getPlatformInvoiceDetail(
    id: number,
  ): Promise<{
    invoice: any;
    transmissions: any[];
    evidences: any[];
    plan: { name: string; code: string; billing_cycle: string } | null;
    organization: {
      id: number;
      name: string;
      legal_name: string | null;
      tax_id: string | null;
      email: string | null;
    } | null;
  } | null> {
    const settings = await this.getSettings();
    const platformOrgId = await this.resolvePlatformOrganizationId();

    // Probe por `fiscal_transmissions.source_type='platform_invoice'`. Si
    // la fila no existe o pertenece a otra entidad contable, retorna null
    // y el detail component verá 404.
    const transmission = await this.prisma.withoutScope().fiscal_transmissions.findFirst({
      where: {
        id,
        source_type: 'platform_invoice',
        accounting_entity_id: settings.accounting_entity_id ?? undefined,
      },
      select: {
        id: true,
        transmission_status: true,
        dian_status: true,
        accounting_status: true,
        document_number: true,
        cufe: true,
        qr_code: true,
        tracking_id: true,
        accepted_at: true,
        rejected_at: true,
        error_message: true,
        created_at: true,
        accounting_entity_id: true,
        organization_id: true,
        source_id: true,
      },
    });

    if (!transmission) return null;
    if (transmission.organization_id !== platformOrgId) return null;

    // Snapshot del origen. Sin él, no tenemos customer / items / totales:
    // el detail no podría renderizar el resumen. Sin snapshot válido
    // devolvemos null y el componente verá 404 — es preferible a
    // renderizar una factura vacía que se confunde con una recién emitida.
    const snapshot = await this.prisma.withoutScope().fiscal_evidences.findFirst({
      where: {
        fiscal_transmission_id: transmission.id,
        evidence_type: 'manual_support',
      },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        fiscal_transmission_id: true,
        evidence_type: true,
        content_hash: true,
        storage_key: true,
        metadata: true,
        created_at: true,
      },
    });

    const meta = (snapshot?.metadata as Record<string, unknown> | null) ?? null;
    const customer =
      (meta && typeof meta === 'object' && 'customer' in meta
        ? (meta as { customer: any }).customer
        : null) ?? null;
    const items =
      (meta && typeof meta === 'object' && 'items' in meta
        ? (meta as { items: any[] }).items
        : null) ?? [];
    const totals =
      (meta && typeof meta === 'object' && 'totals' in meta
        ? (meta as { totals: { subtotal: number; tax_amount: number; total: number } }).totals
        : null) ?? { subtotal: 0, tax_amount: 0, total: 0 };
    const periodStart =
      meta && typeof meta === 'object' && 'period_start' in (meta as any)
        ? ((meta as any).period_start as string | null)
        : null;
    const periodEnd =
      meta && typeof meta === 'object' && 'period_end' in (meta as any)
        ? ((meta as any).period_end as string | null)
        : null;
    const currency =
      meta && typeof meta === 'object' && 'currency' in (meta as any)
        ? ((meta as any).currency as string)
        : 'COP';

    const invoiceNumber = transmission.document_number;
    const issuedAt = transmission.accepted_at ?? transmission.created_at ?? new Date();
    const issuedIso = issuedAt instanceof Date ? issuedAt.toISOString() : String(issuedAt);
    const dueIso = new Date(
      new Date(issuedIso).getTime() + 7 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const synthetic = {
      id: transmission.id,
      invoice_number: invoiceNumber,
      state: 'custom_emitted',
      issued_at: issuedIso,
      due_at: dueIso,
      period_start: periodStart ?? issuedIso,
      period_end: periodEnd ?? issuedIso,
      subtotal: String(totals.subtotal ?? 0),
      tax_amount: String(totals.tax_amount ?? 0),
      total: String(totals.total ?? 0),
      amount_paid: '0',
      currency,
      line_items: items,
    };

    // FB-13: la UI del rail tienda pide estos campos en `invoice.*`.
    // Se sincronizan desde el snapshot del evidence `platform_invoice_snapshot`
    // (kind ya validado en la lectura) para que el detail page del rail
    // plataforma renderice con la misma forma que el rail tienda.
    // `snapshot.metadata` es Prisma.JsonValue (string|number|boolean|object|array);
    // casteamos via unknown para leer campos arbitrarios sin revalidation por
    // linea.
    const metaExtras = (snapshot?.metadata ?? null) as unknown as
      | Record<string, unknown>
      | null;
    const syntheticWithExtras = {
      ...synthetic,
      customer: customer ?? null,
      payment_form: (metaExtras?.['payment_form'] as string | null) ?? null,
      payment_means_code: (metaExtras?.['payment_means_code'] as string | null) ?? null,
      due_date: dueIso,
      operation_type: (metaExtras?.['operation_type'] as string | null) ?? null,
      aiu_contract_object: (metaExtras?.['aiur_contract_object'] as string | null) ?? null,
      global_discount_amount: (metaExtras?.['global_discount_amount'] as number | null) ?? null,
      withholding_amount: (metaExtras?.['withholding_amount'] as number | null) ?? null,
      exchange_rate: (metaExtras?.['exchange_rate'] as number | null) ?? null,
      exchange_rate_date: (metaExtras?.['exchange_rate_date'] as string | null) ?? null,
    };

    return {
      invoice: syntheticWithExtras,
      transmissions: [
        {
          id: transmission.id,
          transmission_status: transmission.transmission_status,
          dian_status: transmission.dian_status,
          accounting_status: transmission.accounting_status,
          document_number: transmission.document_number,
          cufe: transmission.cufe,
          qr_code: transmission.qr_code,
          tracking_id: transmission.tracking_id,
          accepted_at: transmission.accepted_at,
          rejected_at: transmission.rejected_at,
          error_message: transmission.error_message,
          created_at: transmission.created_at,
        },
      ],
      evidences: snapshot
        ? [
            {
              id: snapshot.id,
              fiscal_transmission_id: snapshot.fiscal_transmission_id,
              evidence_type: snapshot.evidence_type,
              content_hash: snapshot.content_hash,
              storage_key: snapshot.storage_key,
              metadata: snapshot.metadata,
              created_at: snapshot.created_at,
            },
          ]
        : [],
      plan: null,
      // La organización "destinatario" no es una org tenant: es free-form.
      // Devolvemos lo que el snapshot guardó del cliente para que la
      // plantilla pinte `legal_name`/`tax_id` en la cabecera. Si el
      // operador pidió "Implements S.A.S", eso aparece acá.
      organization: customer
        ? {
            id: 0,
            name: customer.legal_name ?? '—',
            legal_name: customer.legal_name ?? null,
            tax_id: customer.tax_id ?? null,
            email: customer.email ?? null,
          }
        : null,
    };
  }

  async getSubscriptionInvoiceDetail(id: number): Promise<{
    invoice: any;
    transmissions: any[];
    evidences: any[];
    plan: { name: string; code: string; billing_cycle: string } | null;
    organization: {
      id: number;
      name: string;
      legal_name: string | null;
      tax_id: string | null;
      email: string | null;
    } | null;
  } | null> {
    // El detalle debe limitarse a la entidad fiscal de la plataforma: si una
    // subscription_invoice pertenece a otra entidad, no debe filtrarse a un
    // super-admin que pidió la URL con id=numero. derive in read.
    const settings = await this.getSettings();
    // Hoy TODA `subscription_invoice` pertenece a la org plataforma (es
    // un hecho de la implementación actual). El filtro fino por entidad
    // contable en el `where` confunde a Prisma sobre qué relaciones
    // cargar — el include se omite. Validamos la pertenencia
    // post-query con el campo `accounting_entity_id` de la plataforma,
    // y si difiere, retornamos null (controller lanza 404).
    const invoice = await this.prisma.withoutScope().subscription_invoices.findFirst({
      where: { id },
      include: {
        payments: { orderBy: { created_at: 'desc' } },
        store_subscription: {
          include: {
            plan: { select: { name: true, code: true, billing_cycle: true } },
            store: {
              include: {
                organizations: {
                  select: {
                    id: true,
                    name: true,
                    legal_name: true,
                    tax_id: true,
                    email: true,
                    document_type: true,
                    verification_digit: true,
                    person_type: true,
                    tax_regime: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!invoice) return null;

    // Validación post-query: la org dueña debe ser la plataforma. Hoy
    // siempre coincide; este guard es para el caso futuro en que una
    // partner-org genere SaaS propios y use el mismo endpoint.
    const platformOrgId = await this.resolvePlatformOrganizationId();
    if (invoice.store_subscription.store.organizations.id !== platformOrgId) {
      return null;
    }

    if (!invoice) return null;

    const transmissions = await this.prisma.withoutScope().fiscal_transmissions.findMany({
      where: { source_type: 'subscription_invoice', source_id: id },
      orderBy: { created_at: 'desc' },
      // Evita cargar xml_document, pdf_url, provider_response: cada uno pesa
      // 100–500 KB por transmisión y el detalle no los muestra. Si la
      // factura ha sido reintentada 5 veces, son ~5 MB de payload sin uso.
      select: {
        id: true,
        transmission_status: true,
        dian_status: true,
        accounting_status: true,
        document_number: true,
        cufe: true,
        qr_code: true,
        tracking_id: true,
        accepted_at: true,
        rejected_at: true,
        error_message: true,
        created_at: true,
      },
      take: 10,
    });

    const transmissionIds = transmissions.map((t) => t.id);
    const evidences = transmissionIds.length
      ? await this.prisma.withoutScope().fiscal_evidences.findMany({
          where: { fiscal_transmission_id: { in: transmissionIds } },
          orderBy: { created_at: 'desc' },
          select: {
            id: true,
            fiscal_transmission_id: true,
            evidence_type: true,
            content_hash: true,
            metadata: true,
            storage_key: true,
            created_at: true,
          },
          take: 50,
        })
      : [];

    const org = invoice.store_subscription.store.organizations;

    return {
      invoice,
      transmissions,
      evidences,
      plan: invoice.store_subscription.plan,
      organization: org,
    };
  }

  /**
   * List DIAN resolutions registered for the Vendix platform organization.
   *
   * Platform resolutions are scoped to the derived platform `organization_id`
   * and `store_id IS NULL`. The `environment` filter is informational — the
   * `invoice_resolutions` schema has no environment column, so the actual
   * environment is inherited from the linked DIAN configuration on the
   * platform fiscal settings. Filtering by environment here is best-effort: it
   * passes through to the caller via the response metadata.
   */
  async listResolutions(query: ListPlatformResolutionsQueryDto) {
    // Filtra por la entidad fiscal DERIVADA, no solo por organización.
    //
    // `assertResolution` exige que la resolución pertenezca a esa entidad, así que
    // listar las de otra entidad ofrecía opciones que el guardado rechaza — el
    // usuario elegía una fila legítima y recibía "must belong to the platform
    // accounting entity" sin nada que pudiera cambiar. Además son invisibles para
    // toda lectura scopeada, así que no hay flujo en el que sirvan.
    const accounting_entity_id = await this.resolvePlatformAccountingEntityId();
    const where: Prisma.invoice_resolutionsWhereInput = {
      organization_id: await this.resolvePlatformOrganizationId(),
      store_id: null,
      accounting_entity_id,
    };
    if (query.document_type) {
      where.document_type = query.document_type;
    }
    if (query.is_active !== undefined) {
      where.is_active = query.is_active;
    }

    const rows = await this.prisma.withoutScope().invoice_resolutions.findMany({
      where,
      orderBy: [{ document_type: 'asc' }, { created_at: 'desc' }],
    });

    const settings = await this.getSettings();
    const platformEnv = settings.environment;

    // The model has no env column; surface the platform env so the UI can group.
    const data = rows.map((row) => ({
      ...row,
      environment: platformEnv,
    }));

    // Apply environment filter as a no-op when it equals the platform env;
    // when it does not match, the rows belong to a different config snapshot
    // and we should hide them to keep UI semantics consistent.
    const filtered = query.environment
      ? data.filter((row) => row.environment === query.environment)
      : data;

    return filtered;
  }

  /**
   * CP-platform-fiscal-invoicing-mvp · Phase A.4
   *
   * Lista de resoluciones aptas para EMISION en el rail super-admin.
   * Diferencias con `listResolutions` (legacy management):
   *   - excluye resoluciones expiradas (valid_to < now) o futuras (valid_from > now)
   *   - excluye resoluciones inactivas
   *   - incluye `technical_key_fingerprint` (nunca la cifrada plana)
   *   - filtra explicitamente por `document_type` requerido
   *
   * Razon: el TenantPicker emite directamente sobre el form. No debe
   * poder elegir una resolucion que no le sirve. La regla del piso
   * no la hace este endpoint — la aplica `allocateFiscalNumber`
   * (cursor exhaustado).
   *
   * Para sales_invoice exige ClTec utilizable — la DIAN rechaza sin
   * ClTec y quema consecutivo. Para support_document no la requiere.
   */
  async listResolutionsForEmission(args: {
    organizationId: number;
    accountingEntityId: number;
    documentType: 'sales_invoice' | 'support_document';
    now?: Date;
  }) {
    const now = args.now ?? new Date();
    const rows = await this.prisma.withoutScope().invoice_resolutions.findMany({
      where: {
        organization_id: args.organizationId,
        store_id: null,
        accounting_entity_id: args.accountingEntityId,
        document_type: args.documentType,
        is_active: true,
        valid_from: { lte: now },
        valid_to: { gte: now },
      },
      orderBy: [{ created_at: 'desc' }],
      select: {
        id: true,
        prefix: true,
        resolution_number: true,
        range_from: true,
        range_to: true,
        current_number: true,
        valid_from: true,
        valid_to: true,
        document_type: true,
        technical_key_fingerprint: true,
        created_at: true,
      },
    });

    // Reglas adicionales del lado aplicacion (no Postgres):
    // - sales_invoice: requiere `technical_key_fingerprint` no nulo
    //   (ClTec utilizable, validada por `isWellFormedTechnicalKey`).
    // - support_document: NO requiere ClTec; siempre es emitible.
    // Devolvemos el flag `emittable` para que el form muestre advertencia.
    const techKeyShape: Record<string, unknown> = {};
    for (const row of rows) {
      let emittable = true;
      let cltecStatus: 'present' | 'absent' | 'invalid' = 'absent';

      if (args.documentType === 'sales_invoice') {
        const fingerprint = row.technical_key_fingerprint;
        if (!fingerprint) {
          emittable = false;
          cltecStatus = 'absent';
        } else {
          // El fingerprint es SHA-256 del ClTec. La verificacion final
          // de la forma (long 40 o 64 hex) corre en `allocateFiscalNumber`
          // bajo el candado; aca marcamos 'present' y dejamos la
          // verificacion dura para el submit.
          cltecStatus = 'present';
        }
      } else {
        cltecStatus = 'absent'; // support_document: irrelevante
      }

      techKeyShape[row.id] = { emittable, cltecStatus, fingerprint: row.technical_key_fingerprint ?? null };
      // Adjuntamos `emittable` y `cltec_status` al row sin mutar la select.
      (row as any).emittable = emittable;
      (row as any).cltec_status = cltecStatus;
    }

    return {
      data: rows,
      meta: {
        document_type: args.documentType,
        total: rows.length,
        // El caller puede ordenar/filtrar en cliente.
        rejected_for_missing_cltec: rows.filter(
          (r) => (r as any).cltec_status === 'absent' && args.documentType === 'sales_invoice',
        ).length,
      },
    };
  }

  /**
   * Create a DIAN resolution for the Vendix platform organization
   * (derived platform `organization_id`, `store_id = NULL`).
   *
   * Uniqueness is enforced manually because the schema unique constraint does
   * not cover (organization_id, store_id NULL, document_type, prefix).
   */
  async createResolution(dto: CreatePlatformResolutionDto) {
    if (!PLATFORM_RESOLUTION_DOCUMENT_TYPES.includes(dto.document_type)) {
      throw new BadRequestException(
        `document_type must be one of ${PLATFORM_RESOLUTION_DOCUMENT_TYPES.join(', ')}`,
      );
    }
    if (dto.rango_inicial <= 0) {
      throw new BadRequestException('rango_inicial must be greater than 0');
    }
    if (dto.rango_final <= dto.rango_inicial) {
      throw new BadRequestException(
        'rango_final must be strictly greater than rango_inicial',
      );
    }

    const accountingEntityId = await this.resolvePlatformAccountingEntityId();

    // El eje es exactamente el del índice único que restringe la tabla en base:
    // `invoice_resolutions_entity_prefix_uidx (accounting_entity_id, prefix)
    // WHERE accounting_entity_id IS NOT NULL` — y esa columna es NOT NULL desde
    // 20260522150000, así que el índice aplica siempre.
    //
    // Deliberadamente NO se filtra por `document_type` ni por `is_active`: el
    // índice tampoco los mira. Un prefijo pertenece a UNA fila por entidad,
    // aunque la otra sea de otro tipo de documento o esté desactivada. Filtrar
    // por esas dos columnas hacía el chequeo más permisivo que la base, y el
    // duplicado terminaba saliendo como P2002 crudo, es decir un 500 opaco.
    //
    // Coincide con la realidad DIAN: el prefijo se autoriza por NIT, no por tipo
    // de documento.
    const duplicate = await this.prisma
      .withoutScope()
      .invoice_resolutions.findFirst({
        where: {
          accounting_entity_id: accountingEntityId,
          prefix: dto.prefix,
        },
        select: {
          id: true,
          resolution_number: true,
          document_type: true,
          is_active: true,
        },
      });
    if (duplicate) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_RESOLUTION_007,
        `Ya existe una resolución con prefijo "${dto.prefix}" para ${
          duplicate.document_type === 'sales_invoice'
            ? 'factura de venta'
            : 'documento soporte'
        } (número ${duplicate.resolution_number}${
          duplicate.is_active ? '' : ', desactivada'
        }). La DIAN autoriza el prefijo por NIT, así que no puede repetirse: edita esa resolución o usa otro prefijo.`,
        {
          resolution_id: duplicate.id,
          prefix: dto.prefix,
          document_type: duplicate.document_type,
          is_active: duplicate.is_active,
        },
      );
    }

    const now = new Date();
    const validFrom = dto.valid_from ? new Date(dto.valid_from) : now;
    const validTo = dto.valid_to
      ? new Date(dto.valid_to)
      : new Date(now.getFullYear() + 2, now.getMonth(), now.getDate());
    const resolutionDate = dto.resolution_date
      ? new Date(dto.resolution_date)
      : now;

    assertPlausibleFiscalDate('fecha de resolución', resolutionDate);
    assertPlausibleFiscalDate('válida desde', validFrom);
    assertPlausibleFiscalDate('válida hasta', validTo);

    const created = await this.prisma.withoutScope().invoice_resolutions.create({
      data: {
        organization_id: await this.resolvePlatformOrganizationId(),
        store_id: null,
        accounting_entity_id: accountingEntityId,
        document_type: dto.document_type as PlatformResolutionDocumentType,
        resolution_number: dto.resolution_number ?? `PLATFORM-${dto.prefix}-${Date.now()}`,
        resolution_date: resolutionDate,
        prefix: dto.prefix,
        range_from: dto.rango_inicial,
        range_to: dto.rango_final,
        current_number: dto.rango_inicial - 1,
        valid_from: validFrom,
        valid_to: validTo,
        is_active: true,
        // Validada y normalizada, igual que en los carriles de tienda y de
        // organización. Este es el tercero y el último que faltaba: la consola
        // de super admin no pasa por el mismo `ValidationPipe` (entra por
        // `TenantContextRunner`), así que lo que no exija el servicio no lo
        // exige nadie — y una ClTec mal copiada quema un consecutivo autorizado
        // que no se recupera.
        ...this.technicalKeyVault.sealForWrite(
          assertTechnicalKeyShape(dto.technical_key, {
            prefix: dto.prefix,
          }),
        ),
      },
    });

    return {
      ...created,
      environment: dto.environment,
    };
  }

  /**
   * Partial update of a platform resolution.
   *
   * The DIAN-authorized identity of a resolution is the triple
   * (prefix, document_type, range_from). Once a number has been consumed under
   * that triple, changing it would retroactively re-label documents already
   * reported to the DIAN, so those fields become immutable. Everything else
   * (upper range, validity window, technical key, active flag) stays editable
   * because a real resolution does get extended and re-keyed over its life.
   */
  async updateResolution(id: number, dto: UpdatePlatformResolutionDto) {
    const current = await this.findPlatformResolution(id);
    const issued = current._count.invoices;
    // `current_number` starts at range_from - 1, so reaching range_from means
    // at least one number left the building.
    const consumedNumbers = current.current_number >= current.range_from;
    const locked = consumedNumbers || issued > 0;

    if (locked) {
      const immutable: string[] = [];
      if (dto.prefix !== undefined && dto.prefix !== current.prefix) {
        immutable.push('prefix');
      }
      if (
        dto.document_type !== undefined &&
        dto.document_type !== current.document_type
      ) {
        immutable.push('document_type');
      }
      if (
        dto.rango_inicial !== undefined &&
        dto.rango_inicial !== current.range_from
      ) {
        immutable.push('rango_inicial');
      }
      if (immutable.length > 0) {
        throw new VendixHttpException(
          ErrorCodes.INVOICING_RESOLUTION_005,
          `La resolución ya consumió numeración ante la DIAN: ${immutable.join(', ')} no se puede cambiar. Crea una resolución nueva.`,
          {
            resolution_id: id,
            immutable_fields: immutable,
            issued_invoices: issued,
            current_number: current.current_number,
          },
        );
      }
    }

    const nextPrefix = dto.prefix ?? current.prefix;
    const nextRangeFrom = dto.rango_inicial ?? current.range_from;
    const nextRangeTo = dto.rango_final ?? current.range_to;

    if (nextRangeTo <= nextRangeFrom) {
      throw new BadRequestException(
        'rango_final must be strictly greater than rango_inicial',
      );
    }
    // Shrinking the ceiling below what DIAN already saw would make the next
    // allocation reuse a number that is already in a reported document.
    if (consumedNumbers && nextRangeTo < current.current_number) {
      throw new BadRequestException(
        `rango_final no puede quedar por debajo del último número consumido (${current.current_number})`,
      );
    }

    // Solo el prefijo puede colisionar: el índice único es
    // `(accounting_entity_id, prefix)`, sin `document_type`. Cambiar únicamente el
    // tipo de documento no puede chocar con nada.
    if (nextPrefix !== current.prefix) {
      // Mismo eje que en `createResolution` y que el índice de la base: entidad
      // contable + prefijo, sin filtrar por tipo de documento ni por `is_active`.
      const duplicate = await this.prisma
        .withoutScope()
        .invoice_resolutions.findFirst({
          where: {
            id: { not: id },
            accounting_entity_id: current.accounting_entity_id,
            prefix: nextPrefix,
          },
          select: {
            id: true,
            resolution_number: true,
            document_type: true,
            is_active: true,
          },
        });
      if (duplicate) {
        throw new VendixHttpException(
          ErrorCodes.INVOICING_RESOLUTION_007,
          `Ya existe una resolución con prefijo "${nextPrefix}" para ${
            duplicate.document_type === 'sales_invoice'
              ? 'factura de venta'
              : 'documento soporte'
          } (número ${duplicate.resolution_number}${
            duplicate.is_active ? '' : ', desactivada'
          }). El prefijo se autoriza por NIT y no puede repetirse.`,
          {
            resolution_id: duplicate.id,
            prefix: nextPrefix,
            document_type: duplicate.document_type,
            is_active: duplicate.is_active,
          },
        );
      }
    }

    // Deactivating the resolution the active configuration points at breaks
    // SaaS billing silently on the next invoice, so it is refused up front.
    if (dto.is_active === false && current.is_active) {
      await this.assertResolutionNotWired(id, 'desactivar');
    }

    const data: Prisma.invoice_resolutionsUpdateInput = {};
    if (dto.prefix !== undefined) data.prefix = dto.prefix;
    if (dto.document_type !== undefined) {
      data.document_type = dto.document_type as PlatformResolutionDocumentType;
    }
    if (dto.rango_inicial !== undefined) data.range_from = dto.rango_inicial;
    if (dto.rango_final !== undefined) data.range_to = dto.rango_final;
    if (dto.resolution_number !== undefined) {
      data.resolution_number = dto.resolution_number;
    }
    // Mismas cotas que en la creación: una fecha imposible entra igual por el
    // formulario o por el escáner de IA, y el síntoma aparece horas después.
    if (dto.resolution_date !== undefined) {
      const resolutionDate = new Date(dto.resolution_date);
      assertPlausibleFiscalDate('fecha de resolución', resolutionDate);
      data.resolution_date = resolutionDate;
    }
    if (dto.valid_from !== undefined) {
      const nextValidFrom = new Date(dto.valid_from);
      assertPlausibleFiscalDate('válida desde', nextValidFrom);
      data.valid_from = nextValidFrom;
    }
    if (dto.valid_to !== undefined) {
      const nextValidTo = new Date(dto.valid_to);
      assertPlausibleFiscalDate('válida hasta', nextValidTo);
      data.valid_to = nextValidTo;
    }
    if (dto.technical_key !== undefined) {
      // Las TRES columnas se escriben juntas o la fila queda apuntando a dos
      // claves a la vez, y `reveal()` —que prefiere la cifrada— devolvería la
      // anterior. `sealForWrite` devuelve siempre las tres, incluso en `null`.
      Object.assign(
        data,
        this.technicalKeyVault.sealForWrite(
          assertTechnicalKeyShape(dto.technical_key, {
            resolution_id: id,
          }),
        ),
      );
    }
    if (dto.is_active !== undefined) data.is_active = dto.is_active;

    // While pristine, the cursor must follow the lower bound; otherwise the
    // first allocation would jump straight past the authorized start.
    if (!locked && nextRangeFrom !== current.range_from) {
      data.current_number = nextRangeFrom - 1;
    }

    const updated = await this.prisma
      .withoutScope()
      .invoice_resolutions.update({ where: { id }, data });

    const settings = await this.getSettings();
    this.logger.log(
      `Platform resolution ${id} updated (${Object.keys(data).join(', ') || 'no-op'})`,
    );

    return { ...updated, environment: settings.environment };
  }

  /**
   * Delete a platform resolution, but only while it is pristine.
   *
   * A resolution that already numbered a document is fiscal evidence: deleting
   * it would orphan the trail of which numbers were reported under which DIAN
   * authorization. Those get deactivated, never removed.
   */
  async deleteResolution(id: number) {
    const current = await this.findPlatformResolution(id);

    if (current._count.invoices > 0) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_RESOLUTION_003,
        `La resolución tiene ${current._count.invoices} documento(s) emitido(s). Desactívala en vez de borrarla.`,
        { resolution_id: id, issued_invoices: current._count.invoices },
      );
    }
    if (current.current_number >= current.range_from) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_RESOLUTION_003,
        `La resolución ya consumió numeración ante la DIAN (va en ${current.current_number}). Desactívala en vez de borrarla.`,
        { resolution_id: id, current_number: current.current_number },
      );
    }

    await this.assertResolutionNotWired(id, 'borrar');

    await this.prisma.withoutScope().invoice_resolutions.delete({
      where: { id },
    });

    this.logger.log(`Platform resolution ${id} deleted`);
    return { id, deleted: true };
  }

  /**
   * Loads a resolution that really belongs to the platform scope
   * (org=1, store_id=NULL). Anything else is a 404 rather than a 403 so this
   * endpoint cannot be used to probe which tenant resolution ids exist.
   */
  private async findPlatformResolution(id: number) {
    const resolution = await this.prisma
      .withoutScope()
      .invoice_resolutions.findFirst({
        where: {
          id,
          organization_id: await this.resolvePlatformOrganizationId(),
          store_id: null,
        },
        include: { _count: { select: { invoices: true } } },
      });

    if (!resolution) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_FIND_002,
        'La resolución no existe en el alcance de la plataforma',
        { resolution_id: id },
      );
    }

    return resolution;
  }

  /**
   * Refuses a destructive change on the resolution a live platform flow is
   * wired to. Both platform fiscal switches can point at a resolution:
   * subscription invoicing and the vendor documento soporte.
   */
  private async assertResolutionNotWired(
    id: number,
    action: 'borrar' | 'desactivar',
  ): Promise<void> {
    const rows = await this.prisma.withoutScope().platform_settings.findMany({
      where: { key: { in: [SETTINGS_KEY, VENDOR_SUPPORT_SETTINGS_KEY] } },
    });

    const wiredTo = rows
      .filter(
        (row) =>
          ((row.value ?? {}) as { invoice_resolution_id?: number | null })
            .invoice_resolution_id === id,
      )
      .map((row) => row.key);

    if (wiredTo.length > 0) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_RESOLUTION_004,
        `No se puede ${action}: la configuración fiscal activa (${wiredTo.join(', ')}) apunta a esta resolución. Reasígnala primero.`,
        { resolution_id: id, wired_to: wiredTo },
      );
    }
  }

  /**
   * Reads the stored settings and OVERRIDES the two identity ids with what the
   * platform resolver derives.
   *
   * ## Why the stored value cannot be trusted
   *
   * `platform_organization_id` and `accounting_entity_id` are not preferences —
   * they are facts about which legal entity Vendix is, derivable from
   * `organizations.is_platform` and `organizations.fiscal_scope`. Worse, the
   * SCOPED Prisma client re-derives the fiscal entity on every query and ignores
   * whatever these settings say. A stored value that disagrees therefore does not
   * degrade: it produces `404` on rows that plainly exist, and no value an
   * operator types can reconcile the two sides.
   *
   * Production reached exactly that state — settings pointing at a STORE entity
   * (`accounting_entities.id=18`, `store_id=1`) while the scope resolved the
   * consolidated one, so the habilitación resolution written under 18 was
   * invisible to the very flow that had to read it.
   *
   * Normalising on READ (instead of a migration) is deliberate: the derived value
   * is always current, and the row rewrites itself on the next `upsertConfig`
   * without a data migration that could go stale the moment the entity changes.
   */
  private async getSettings(): Promise<SubscriptionFiscalSettings> {
    const row = await this.prisma.withoutScope().platform_settings.findUnique({
      where: { key: SETTINGS_KEY },
    });
    const value = (row?.value ?? {}) as Partial<SubscriptionFiscalSettings>;
    const derived = await this.derivePlatformIdentity();

    if (
      derived.accounting_entity_id &&
      value.accounting_entity_id &&
      value.accounting_entity_id !== derived.accounting_entity_id
    ) {
      this.logger.warn(
        `Los ajustes fiscales de plataforma apuntan a accounting_entity_id=${value.accounting_entity_id} ` +
          `pero la entidad derivada es ${derived.accounting_entity_id}. Se usa la derivada: es la única que ` +
          `el cliente Prisma scopeado resuelve.`,
      );
    }

    return {
      is_enabled: value.is_enabled ?? false,
      auto_issue: value.auto_issue ?? false,
      environment: value.environment ?? 'test',
      platform_organization_id:
        derived.platform_organization_id ?? value.platform_organization_id ?? null,
      accounting_entity_id:
        derived.accounting_entity_id ?? value.accounting_entity_id ?? null,
      dian_configuration_id: value.dian_configuration_id ?? null,
      invoice_resolution_id: value.invoice_resolution_id ?? null,
      last_tested_at: value.last_tested_at ?? null,
      last_test_result: value.last_test_result ?? null,
      updated_by_user_id: value.updated_by_user_id ?? null,
      updated_at: value.updated_at ?? null,
    };
  }

  /**
   * Wrapper publico que retorna la identidad resuelta (organization_id +
   * accounting_entity_id) para que el facade V1 pueda pasarle esos
   * parametros sin tener que duplicar la logica de derivacion.
   *
   * Por diseño: este metodo es lo unico del legacy que el facade V1
   * consume en runtime (Phase B.1). El controller lo llama antes de
   * `listResolutionsForEmission` y `evaluateReadiness` para evitar
   * hardcodear org=0/accountingEntityId=0.
   */
  async getPlatformIdentity(): Promise<{
    organizationId: number;
    accountingEntityId: number;
  }> {
    const settings = await this.getSettings();
    return {
      organizationId: settings.platform_organization_id ?? 0,
      accountingEntityId: settings.accounting_entity_id ?? 0,
    };
  }

  /**
   * Version extendida para el controller V1: retorna los 3 IDs
   * (organization + accounting_entity + dian_configuration) que el
   * controller necesita para resolver el cliente (organizationId)
   * + el dian_configuration_id al crear transmisiones platform.
   */
  async getSettingsForController(): Promise<{
    platform_organization_id: number;
    accounting_entity_id: number;
    dian_configuration_id: number;
  }> {
    const settings = await this.getSettings();
    return {
      platform_organization_id: settings.platform_organization_id ?? 0,
      accounting_entity_id: settings.accounting_entity_id ?? 0,
      dian_configuration_id: settings.dian_configuration_id ?? 0,
    };
  }

  private async saveSettings(settings: SubscriptionFiscalSettings): Promise<void> {
    await this.prisma.withoutScope().platform_settings.upsert({
      where: { key: SETTINGS_KEY },
      create: {
        key: SETTINGS_KEY,
        value: settings as unknown as Prisma.InputJsonValue,
        default_trial_days: 14,
        description: 'Platform DIAN electronic billing settings for Vendix SaaS subscription invoices',
      },
      update: {
        value: settings as unknown as Prisma.InputJsonValue,
        updated_at: new Date(),
      },
    });
  }

  private async requireConfiguredSettings(): Promise<SubscriptionFiscalSettings> {
    const settings = await this.getSettings();
    if (
      !settings.platform_organization_id ||
      !settings.accounting_entity_id ||
      !settings.dian_configuration_id
    ) {
      throw new BadRequestException('Subscription fiscal billing is not configured');
    }
    return settings;
  }

  private async getActiveConfig(settings: SubscriptionFiscalSettings) {
    if (!settings.dian_configuration_id) {
      throw new BadRequestException('DIAN configuration is required');
    }
    const config = await this.prisma.withoutScope().dian_configurations.findUnique({
      where: { id: settings.dian_configuration_id },
    });
    if (!config) {
      throw new BadRequestException('DIAN configuration not found');
    }
    return config;
  }

  /**
   * Busca la configuración DIAN de plataforma por el MISMO eje que la restringe
   * en base: el índice parcial `dian_configurations_org_scope_uq`
   * `(organization_id, nit, configuration_type) WHERE store_id IS NULL`.
   *
   * Antes se buscaba filtrando por la entidad contable derivada, un eje más
   * estrecho que el del índice. Una fila escrita bajo otra entidad quedaba
   * invisible para la lectura pero seguía siendo visible para la restricción: el
   * upsert concluía "no existe", intentaba crear, y Postgres contestaba P2002.
   * Al cliente eso llega como un 500 sin ninguna pista de qué fila estorba.
   *
   * Regla general: el eje con el que se decide "existe o no existe" tiene que ser
   * el mismo con el que la base decide "es la misma fila".
   */
  private async findPlatformInvoicingConfig(params: {
    organization_id: number;
    nit: string;
    preferred_id: number | null;
  }) {
    const client = this.prisma.withoutScope();

    if (params.preferred_id) {
      const byId = await client.dian_configurations.findFirst({
        where: {
          id: params.preferred_id,
          organization_id: params.organization_id,
          store_id: null,
          configuration_type: 'invoicing',
        },
      });
      if (byId) {
        // Cambiar el NIT de la config apuntada colisiona con la fila que ya lo
        // tenga. Eso es un 409 explicable, no un P2002 crudo.
        if (byId.nit !== params.nit) {
          const holder = await client.dian_configurations.findFirst({
            where: {
              organization_id: params.organization_id,
              store_id: null,
              nit: params.nit,
              configuration_type: 'invoicing',
              id: { not: byId.id },
            },
            select: { id: true, name: true },
          });
          if (holder) {
            throw new VendixHttpException(
              ErrorCodes.DIAN_CONFIG_002,
              `Ya existe otra configuración DIAN de plataforma con el NIT ${params.nit} ("${holder.name}"). Edita esa configuración en vez de reasignarle el NIT a esta.`,
              { conflicting_configuration_id: holder.id, nit: params.nit },
            );
          }
        }
        return byId;
      }
    }

    return client.dian_configurations.findFirst({
      where: {
        organization_id: params.organization_id,
        store_id: null,
        nit: params.nit,
        configuration_type: 'invoicing',
      },
      orderBy: [{ is_default: 'desc' }, { id: 'asc' }],
    });
  }

  /**
   * La identidad llega como parámetro explícito, no leída del DTO: los campos del
   * DTO son opcionales e ignorados, y depender de que el llamador los haya
   * sobrescrito antes es exactamente el acoplamiento que produjo el desajuste.
   */
  private async createDianConfig(
    dto: UpsertSubscriptionFiscalConfigDto,
    identity: { organization_id: number; accounting_entity_id: number },
  ) {
    return this.prisma.withoutScope().dian_configurations.create({
      data: {
        organization_id: identity.organization_id,
        store_id: null,
        accounting_entity_id: identity.accounting_entity_id,
        name: dto.name,
        nit: dto.nit,
        nit_dv: dto.nit_dv,
        nit_type: 'NIT',
        is_default: true,
        configuration_type: 'invoicing',
        operation_mode: 'own_software',
        software_id: dto.software_id,
        software_pin_encrypted: this.encryption.encrypt(dto.software_pin!),
        environment: dto.environment,
        // En CREATE no hay `previous` — el caller decide el ambiente que
        // manda en `dto.environment`. Si lo dejó undefined (omitido), el
        // caller DEBIÓ haber incluido el campo y la validación @IsOptional
        // lo deja pasar. Aquí el fallback es solo defensivo.
        enablement_status: this.nextEnablementStatus(dto, dto.environment ?? 'test'),
        test_set_id: dto.test_set_id,
      },
    });
  }

  private async updateDianConfig(
    id: number,
    dto: UpsertSubscriptionFiscalConfigDto,
    options: { previous: SubscriptionFiscalSettings; realign_accounting_entity_id?: number | null },
  ) {
    // El estado actual se lee ACÁ, no se recibe por parámetro.
    //
    // Un parámetro opcional que el llamador puede omitir es exactamente cómo este
    // defecto se volvió invisible las otras tres veces. Con la lectura dentro del
    // método no hay forma de olvidarla.
    const current = await this.prisma
      .withoutScope()
      .dian_configurations.findUnique({
        where: { id },
        select: { enablement_status: true },
      });

    const data: Prisma.dian_configurationsUpdateInput = {
      name: dto.name,
      nit: dto.nit,
      nit_dv: dto.nit_dv,
      software_id: dto.software_id,
      environment: dto.environment,
      test_set_id: dto.test_set_id,
      updated_at: new Date(),
    };

    // CUARTA COPIA DEL MISMO DEFECTO: una escritura de `enablement_status` sin
    // guarda podía degradar una habilitación concedida.
    //
    // `nextEnablementStatus` devuelve `not_started` para todo lo que no sea
    // «habilitado y en test», así que editar el NOMBRE de una configuración ya
    // `enabled` borraba el registro de que la DIAN la había habilitado. Es el
    // mismo fallo que `abandonTestSet` producía el 2026-08-09, y las otras dos
    // copias ya las cierra `canWriteEnablementStatus` en `dian-test.service`.
    //
    // `enabled` REGISTRA UN HECHO DE LA DIAN. Ningún guardado de formulario puede
    // retirarlo: eso solo lo hace la DIAN, y se refleja por otras vías
    // (`suspended`, `expired`).
    if (canWriteEnablementStatus(current?.enablement_status ?? null)) {
      data.enablement_status = this.nextEnablementStatus(
        dto,
        dto.environment ?? options.previous.environment,
      );
    }
    if (dto.software_pin && dto.software_pin !== '****') {
      data.software_pin_encrypted = this.encryption.encrypt(dto.software_pin);
    }
    const realign = options?.realign_accounting_entity_id ?? null;
    if (realign !== null) {
      data.accounting_entity = { connect: { id: realign } };
      this.logger.warn(
        `La configuración DIAN ${id} colgaba de otra entidad contable y era invisible para el cliente scopeado. Se realinea a accounting_entity_id=${realign} en este guardado.`,
      );
    }
    return this.prisma.withoutScope().dian_configurations.update({
      where: { id },
      data,
    });
  }

  private nextEnablementStatus(
    dto: UpsertSubscriptionFiscalConfigDto,
    effectiveEnvironment: SubscriptionFiscalEnvironment,
  ): 'testing' | 'not_started' {
    // `dto.environment` puede ser undefined cuando el caller NO cambió el
    // ambiente (la edición normal lo omite). Usamos el ambiente efectivo
    // (DTO o previous) para que la decisión refleje el estado real, no un
    // `undefined` que retornaría `'not_started'` para un CREATE con
    // is_enabled=true en sandbox.
    if (dto.is_enabled && effectiveEnvironment === 'test') return 'testing';
    return 'not_started';
  }

  private async ensureSingleDefault(
    configId: number,
    organizationId: number,
    accountingEntityId: number,
  ): Promise<void> {
    await this.prisma.withoutScope().dian_configurations.updateMany({
      where: {
        organization_id: organizationId,
        accounting_entity_id: accountingEntityId,
        configuration_type: 'invoicing',
        id: { not: configId },
      },
      data: { is_default: false },
    });
    await this.prisma.withoutScope().dian_configurations.update({
      where: { id: configId },
      data: { is_default: true },
    });
  }

  private async assertFiscalContext(
    organizationId: number,
    accountingEntityId: number,
  ): Promise<void> {
    const entity = await this.prisma.withoutScope().accounting_entities.findFirst({
      where: {
        id: accountingEntityId,
        organization_id: organizationId,
        is_active: true,
      },
    });
    if (!entity) {
      throw new BadRequestException(
        'The accounting entity must belong to the selected platform organization',
      );
    }
  }

  private async assertResolution(
    resolutionId: number,
    accountingEntityId: number,
  ): Promise<void> {
    // SaaS subscription invoices always use sales_invoice. The platform-level
    // resolution must belong to the platform organization (org=1), platform
    // accounting entity (store_id=null) and be active. Resolutions created via
    // POST /superadmin/subscriptions/fiscal/resolutions live under this scope.
    const resolution = await this.prisma.withoutScope().invoice_resolutions.findFirst({
      where: {
        id: resolutionId,
        organization_id: await this.resolvePlatformOrganizationId(),
        store_id: null,
        accounting_entity_id: accountingEntityId,
        document_type: 'sales_invoice',
        is_active: true,
      },
    });
    if (!resolution) {
      throw new BadRequestException(
        'The fiscal resolution must be active, sales_invoice, and belong to the platform accounting entity',
      );
    }
  }

  /**
   * SIN REFERENCIAS DESDE QUE `PATCH config` RECHAZA PRODUCCIÓN. NO SE BORRA AÚN.
   *
   * Era la única guarda de la vieja activación: exigía `last_test_result.ok` con
   * `environment === 'production'` en la última hora. El problema es que
   * `testConnection` graba el ambiente leyéndolo de `config.environment`, así que
   * un resultado con `environment: 'production'` solo existe DESPUÉS de que la
   * configuración ya está en producción. Como pre-requisito para promover era
   * insatisfacible: el flujo real era voltear el ambiente primero con un PATCH
   * —sin guarda ninguna— y recién entonces poder cumplirla.
   *
   * Cerrada esa vía, la guarda no puede cumplirse nunca antes de promover. Queda
   * acá, sin llamar y documentada, en vez de borrada en silencio: una verificación
   * de conexión POSTERIOR a la promoción sigue teniendo sentido y esta función es
   * la pieza para ello, pero eso es una decisión de flujo que nadie ha pedido.
   */
  private assertFreshProductionTest(
    settings: SubscriptionFiscalSettings,
    fingerprint: string,
    confirmed?: boolean,
  ): void {
    if (!confirmed) {
      throw new BadRequestException(
        'Production activation requires explicit confirmation',
      );
    }
    const testedAt = settings.last_tested_at
      ? new Date(settings.last_tested_at).getTime()
      : 0;
    const fresh = Date.now() - testedAt <= PRODUCTION_TEST_FRESHNESS_MS;
    const result = settings.last_test_result;
    if (
      !result?.ok ||
      result.environment !== 'production' ||
      result.config_fingerprint !== fingerprint ||
      !fresh
    ) {
      throw new BadRequestException(
        'Run a successful DIAN production connection test in the last hour before activating production',
      );
    }
  }

  private configFingerprint(config: {
    id: number;
    nit: string;
    software_id: string;
    environment: string;
    software_pin_encrypted?: string | null;
    certificate_fingerprint?: string | null;
  }): string {
    return createHash('sha256')
      .update(
        [
          config.id,
          config.nit,
          config.software_id,
          config.environment,
          config.software_pin_encrypted ?? '',
          config.certificate_fingerprint ?? '',
        ].join('|'),
      )
      .digest('hex');
  }

  private async countTransmissions(statuses: string[]): Promise<number> {
    return this.prisma.withoutScope().fiscal_transmissions.count({
      where: {
        source_type: 'subscription_invoice',
        transmission_status: { in: statuses as any },
      },
    });
  }

  private maskConfig(config: any) {
    return {
      ...config,
      software_pin_encrypted: config.software_pin_encrypted ? '****' : null,
      certificate_password_encrypted: config.certificate_password_encrypted
        ? '****'
        : null,
      has_certificate: !!config.certificate_s3_key,
    };
  }

  private async loadSubscriptionInvoice(
    invoiceId: number,
  ): Promise<SubscriptionInvoiceForFiscal> {
    const invoice = await this.prisma.withoutScope().subscription_invoices.findUnique({
      where: { id: invoiceId },
      include: {
        payments: { orderBy: { created_at: 'desc' } },
        store_subscription: {
          include: {
            plan: { select: { name: true, code: true, billing_cycle: true } },
            store: {
              include: {
                organizations: {
                  select: {
                    id: true,
                    name: true,
                    legal_name: true,
                    tax_id: true,
                    email: true,
                    document_type: true,
                    verification_digit: true,
                    person_type: true,
                    tax_regime: true,
                    fiscal_responsibilities: true,
                    // TODAS las direcciones de la organización, no sólo las de
                    // tipo `billing`: la cascada de la emisión agota primero las
                    // fiscales (`billing` / `legal`) y después cualquier otra, y
                    // no puede elegir entre candidatas que la consulta filtró.
                    // El orden de la base entra tal cual —la principal primero—;
                    // la POLÍTICA la aplica `resolveAcquirerAddress`.
                    addresses: {
                      orderBy: [{ is_primary: 'desc' }, { id: 'asc' }],
                      take: ACQUIRER_ADDRESS_CANDIDATE_LIMIT,
                      select: {
                        address_line1: true,
                        address_line2: true,
                        city: true,
                        state_province: true,
                        country_code: true,
                        postal_code: true,
                        municipality_code: true,
                        is_primary: true,
                        type: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!invoice) {
      throw new BadRequestException('Subscription invoice not found');
    }
    return invoice as unknown as SubscriptionInvoiceForFiscal;
  }

  private async ensureTransmission(
    invoice: SubscriptionInvoiceForFiscal,
    settings: SubscriptionFiscalSettings,
    config: { id: number; accounting_entity_id: number; organization_id: number },
  ) {
    const client = this.prisma.withoutScope();
    const existing = await client.fiscal_transmissions.findFirst({
      where: {
        source_type: 'subscription_invoice',
        source_id: invoice.id,
        accounting_entity_id: settings.accounting_entity_id!,
        document_type: 'sales_invoice',
      },
      orderBy: { created_at: 'desc' },
    });
    if (existing) {
      if (existing.transmission_status === 'accepted') return existing;
      return client.fiscal_transmissions.update({
        where: { id: existing.id },
        data: {
          transmission_status:
            existing.transmission_status === 'error' ? 'retrying' : 'queued',
          retry_count:
            existing.transmission_status === 'error'
              ? { increment: 1 }
              : existing.retry_count,
          last_retry_at:
            existing.transmission_status === 'error' ? new Date() : undefined,
          updated_at: new Date(),
        },
      });
    }

    return client.$transaction(async (tx: any) => {
      const number = await this.allocateFiscalNumber(tx, settings);
      const providerData = this.buildProviderData(
        invoice,
        number.invoice_number,
        number.resolution,
      );
      return tx.fiscal_transmissions.create({
        data: {
          organization_id: config.organization_id,
          store_id: null,
          accounting_entity_id: settings.accounting_entity_id!,
          dian_configuration_id: config.id,
          document_type: 'sales_invoice',
          source_type: 'subscription_invoice',
          source_id: invoice.id,
          document_number: number.invoice_number,
          idempotency_key: `subscription_invoice:${invoice.id}`,
          request_hash: this.hash(providerData),
          transmission_status: 'queued',
          dian_status: 'pending',
          accounting_status: 'blocked',
          created_by_user_id: RequestContextService.getUserId() ?? null,
        },
      });
    });
  }

  /**
   * Carga la resolución de numeración de la plataforma.
   *
   * NO filtra por `is_active` ni por vigencia a propósito: si la resolución está
   * desactivada o vencida, `resolveInvoiceControl` lanza diciendo exactamente cuál
   * de las dos cosas pasa y con qué fechas. Filtrarlo aquí lo convertiría en un
   * «no encontrada» genérico, que es el mensaje que obliga a ir a la base a
   * averiguar qué falló.
   */
  private async loadInvoiceResolution(
    settings: SubscriptionFiscalSettings,
  ): Promise<PlatformInvoiceResolution> {
    if (!settings.invoice_resolution_id) {
      throw new BadRequestException('A DIAN invoice resolution is required');
    }
    const resolution = await this.prisma
      .withoutScope()
      .invoice_resolutions.findFirst({
        where: {
          id: settings.invoice_resolution_id,
          accounting_entity_id: settings.accounting_entity_id ?? undefined,
          document_type: 'sales_invoice',
        },
      });
    if (!resolution) {
      throw new BadRequestException(
        `No existe la resolución ${settings.invoice_resolution_id} de factura de venta para la entidad contable de la plataforma`,
      );
    }
    return resolution as PlatformInvoiceResolution;
  }

  private async allocateFiscalNumber(
    tx: any,
    settings: SubscriptionFiscalSettings,
    preferredResolutionId?: number,
  ): Promise<{
    invoice_number: string;
    resolution_id: number;
    resolution: PlatformInvoiceResolution;
  }> {
    if (!settings.invoice_resolution_id) {
      throw new BadRequestException('A DIAN invoice resolution is required');
    }
    // Llave unificada con el riel de tienda. Antes la plataforma usaba un
    // namespace propio (`subscription_fiscal_resolution:...`) sobre la misma
    // entidad contable y el mismo `document_type`. Las dos transacciones
    // (rail SaaS y rail tienda) no se serializaban entre sí: ambas leían
    // `current_number` antes del UPDATE row-lock de Postgres, calculaban el
    // mismo `next = current_number + 1` y emitían documentos con números
    // consecutivos idénticos — irrecuperables ante la DIAN. A.4
    // (habilitar facturación en tienda 1) prendía exactamente este semáforo.
    // Adoptamos la misma llave del `invoice-number-generator.ts:110` para
    // que `pg_advisory_xact_lock` serialice TODO el espacio
    // (entidad, document_type) en una sola asignación concurrente.
    const lockKey = `invoice_resolution:${settings.accounting_entity_id}:sales_invoice`;
    // pg_advisory_xact_lock returns void — must use $executeRaw, not $queryRaw.
    // Prisma's driver adapter (7.4.1) cannot map a `void` result column and
    // throws P2010 UnsupportedNativeDataType when this runs through $queryRaw.
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', lockKey);

    // F1 (auditoría vendix-db): el caller puede pedir una resolución concreta
    // vía `dto.resolution_id`. Si la pide, ESA se usa — siempre que pase el
    // resto del filtro (entidad contable, tipo de documento, activa, dentro
    // de la ventana de vigencia). Si NO pasa el filtro, error EXPLÍCITO
    // nombrando la resolución pedida: caer en silencio a la del setting
    // emitiría contra otra autorización sin avisar y el operador creería
    // que está emitiendo contra la que eligió.
    const resolutionIdToFind =
      preferredResolutionId ?? settings.invoice_resolution_id;
    const resolution = await tx.invoice_resolutions.findFirst({
      where: {
        id: resolutionIdToFind,
        accounting_entity_id: settings.accounting_entity_id,
        document_type: 'sales_invoice',
        is_active: true,
        valid_from: { lte: new Date() },
        valid_to: { gte: new Date() },
      },
    });
    if (!resolution) {
      if (
        preferredResolutionId !== undefined &&
        preferredResolutionId !== settings.invoice_resolution_id
      ) {
        throw new BadRequestException(
          `La resolución #${preferredResolutionId} pedida para esta factura no está activa, está vencida, no pertenece a la entidad contable ${settings.accounting_entity_id} o no es de ventas (sales_invoice). Verificá su estado antes de emitir.`,
        );
      }
      throw new BadRequestException('No active DIAN sales invoice resolution found');
    }

    // ── ClTec ANTES de mover el cursor ────────────────────────────────────────
    //
    // Copiado de `invoice-number-generator.ts:181-201`, que lo aprendió caro: el
    // 14/08/2026 una clave técnica de 38 caracteres hizo rechazar una factura
    // real por «CUFE mal calculado» y quemó un consecutivo autorizado que no se
    // recupera. Comprobarlo aquí —bajo el candado consultivo que ya serializa la
    // asignación y ANTES del `updateMany`— es la diferencia entre un error
    // barato y un número perdido.
    //
    // Se valida por la BÓVEDA y no por la columna plana, porque `reveal()`
    // prefiere la cifrada y es esa la que después se hashea: una fila con la
    // plana corregida y la cifrada rancia pasaría con 40 hex impecables y
    // firmaría con la vieja.
    const technical_key = normalizeTechnicalKey(
      this.technicalKeyVault.reveal(resolution),
    );
    if (!isWellFormedTechnicalKey(technical_key)) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_RESOLUTION_011,
        `La resolución ${resolution.prefix}${resolution.resolution_number} de la plataforma no tiene una clave técnica (ClTec) utilizable: ` +
          `${technical_key.length === 0 ? 'está vacía' : `tiene ${technical_key.length} caracteres`} y la DIAN la emite de ` +
          `${TECHNICAL_KEY_LENGTHS_LABEL} en hexadecimal. Corrígela antes de emitir: con una clave equivocada la DIAN rechaza la ` +
          'factura por CUFE mal calculado y el consecutivo autorizado que gasta no se recupera. No se asignó numeración.',
        {
          resolution_id: resolution.id,
          document_type: 'sales_invoice',
          technical_key_length: technical_key.length,
          expected_lengths: [...TECHNICAL_KEY_LENGTHS],
        },
      );
    }

    // ── Suelo del rango autorizado ────────────────────────────────────────────
    //
    // `{ increment: 1 }` a ciegas sobre una resolución cuyo `current_number`
    // derivó a 0 emite el número 1: fuera del rango que la DIAN autorizó, y la
    // DIAN los rechaza todos, uno por uno. Con el suelo aplicado, el primer
    // número de una resolución nueva o derivada es exactamente `range_from`.
    //
    // La asignación pasa a ser ABSOLUTA (`cursor + 1`) y no incremental, porque
    // lo que tiene que aterrizar es el valor ya nivelado. Es seguro bajo el
    // candado consultivo: ninguna asignación concurrente cabe entre la lectura y
    // esta escritura. Espejo de `invoice-number-generator.ts:203-232`.
    const floor = resolution.range_from - 1;
    const cursor =
      resolution.current_number < floor ? floor : resolution.current_number;

    if (cursor !== resolution.current_number) {
      this.logger.warn(
        `Resolución de plataforma #${resolution.id}: el cursor ${resolution.current_number} estaba por debajo de su suelo ` +
          `autorizado ${floor}; se asigna desde ${resolution.range_from} en vez de emitir numeración fuera de rango`,
      );
    }

    const updatedCount = await tx.invoice_resolutions.updateMany({
      where: {
        id: resolution.id,
        current_number: { lt: resolution.range_to },
      },
      data: { current_number: cursor + 1 },
    });
    if (updatedCount.count !== 1) {
      throw new BadRequestException('DIAN invoice resolution is exhausted');
    }

    const updated = await tx.invoice_resolutions.findUnique({
      where: { id: resolution.id },
    });
    return {
      invoice_number: `${updated.prefix}${updated.current_number}`,
      resolution_id: updated.id,
      // La fila RECARGADA, la misma cuyo `current_number` se acaba de consumir, para
      // que la autorización declarada sea la de la resolución que dio el número.
      resolution: updated as PlatformInvoiceResolution,
    };
  }

  /**
   * Fields DIAN needs from the adquiriente that Vendix cannot invent. Returns
   * the list of what is missing (empty = complete) so the caller can name them
   * to whoever has to fix them, instead of failing with an opaque rejection
   * hours later.
   *
   * `person_type` and `document_type` are NOT required: the UBL builder derives
   * both from the NIT when absent, and that derivation is correct for the only
   * two shapes a paying organization can take.
   */
  private missingCustomerFiscalData(
    invoice: SubscriptionInvoiceForFiscal,
  ): string[] {
    const org = invoice.store_subscription.store.organizations;
    const missing: string[] = [];
    if (!org) return ['organization'];

    const { number, dv } = this.splitCustomerNit(org);
    if (!number) missing.push('tax_id');
    // A NIT without its DV cannot fill CompanyID/@schemeID. Other document
    // types (CC, CE) legitimately have no DV, so only demand it for NIT.
    // `dv` covers the persisted column, the inline `900123456-8` form, and the
    // derived checksum — all three are equally valid sources.
    const documentType = org.document_type ?? (org.tax_id ? '31' : null);
    if (documentType === '31' && !dv) {
      missing.push('verification_digit');
    }
    if (!org.legal_name?.trim()) missing.push('legal_name');
    if (!org.email?.trim()) missing.push('email');

    // LA MISMA cascada que va a emitir. Se pregunta acá, ANTES de asignar el
    // consecutivo, porque un documento sin dirección de adquiriente lo quema
    // igual: la DIAN lo rechaza para un adquiriente con NIT.
    //
    // La cascada exige que la dirección sea EMITIBLE (`canEmitAddress`), y para
    // una dirección colombiana eso significa municipio de la lista DANE. No se
    // relaja: emitir es estricto —el papel se va con el cliente y no se
    // retracta—, al contrario de la LECTURA del perfil de checkout, que sí
    // devuelve la fila cruda para que el tenant complete lo que falta.
    if ((org.addresses?.length ?? 0) === 0) {
      missing.push('billing_address');
    } else if (!this.resolveCustomerAddress(org)) {
      // Hay direcciones, pero NINGUNA es emitible. Para una dirección
      // colombiana la única causa es el municipio DANE, que es también lo único
      // que el tenant puede corregir.
      missing.push('billing_address.municipality_code');
    }

    return missing;
  }

  /**
   * Dirección del ADQUIRIENTE por la cascada única de la emisión: direcciones
   * fiscales (`billing` / `legal`) primero, cualquier otra de la organización
   * después. Devuelve además de qué escalón salió.
   *
   * El TERCER escalón de la cascada se deja deliberadamente vacío
   * (`store_address: null`): el emisor de esta factura es Vendix, no el tenant,
   * así que el domicilio del emisor JAMÁS puede ser el respaldo de la dirección
   * del adquiriente. Rellenarlo declararía que la operación ocurrió en el
   * municipio de Vendix, que es exactamente la clase de dato inventado que la
   * cascada existe para evitar.
   *
   * `null` significa «no lo sé», y quien pregunte tiene que decirlo en voz alta
   * —ver `missingCustomerFiscalData`—, no rellenarlo.
   */
  private resolveCustomerAddress(
    org: SubscriptionInvoiceForFiscal['store_subscription']['store']['organizations'],
  ): ResolvedAcquirerAddress | null {
    const rows = org?.addresses ?? [];
    if (rows.length === 0) return null;

    const candidates: AcquirerAddressCandidate[] = rows.map((row) => ({
      type: row.type,
      address_line: [row.address_line1, row.address_line2]
        .filter(Boolean)
        .join(' '),
      city_code: row.municipality_code ?? undefined,
      city_name: row.city,
      // El departamento se DERIVA del municipio, que es su prefijo Divipola.
      // Resolverlo por nombre descartaría una fila con código bueno y
      // departamento mal escrito.
      department_code: row.municipality_code
        ? row.municipality_code.slice(0, 2)
        : undefined,
      department_name: row.state_province ?? undefined,
      country_code: row.country_code,
      postal_code: row.postal_code ?? undefined,
    }));

    return resolveAcquirerAddress({ candidates, store_address: null });
  }

  /**
   * Dirección del adquiriente que viaja en el payload, ya elegida por la
   * cascada y en la forma canónica de la emisión (`DianAddressFields`).
   *
   * Devuelve `undefined` cuando ninguna dirección es emitible: el proveedor omite
   * entonces el grupo entero en vez de emitir uno a medio llenar. En el camino
   * normal eso no llega a pasar —`missingCustomerFiscalData` ya frenó la emisión
   * antes de asignar el consecutivo—; este respaldo es para el llamador que
   * construya el payload sin pasar por esa compuerta (p. ej. el `request_hash`).
   *
   * El RESPALDO SE ANUNCIA. Un respaldo silencioso es lo que produjo el defecto
   * original en la emisión de tienda: el documento declaraba un municipio que
   * nadie había elegido y no había forma de saberlo hasta el cruce de la DIAN.
   * Acá se anuncia con la misma severidad y por la misma razón.
   *
   * El `type` NO viaja: el proveedor vuelve a correr la cascada sobre lo que
   * recibe y, sin `type`, la clasifica como fiscal — que es lo que significa una
   * dirección compuesta PARA ESTE documento (ver `classifyAcquirerAddressType`).
   * Mandarlo obligaría además a una búsqueda de direcciones por `users` que en el
   * riel de plataforma no aplica: el adquiriente es una organización.
   */
  private buildCustomerAddress(
    org: SubscriptionInvoiceForFiscal['store_subscription']['store']['organizations'],
  ): DianAddressFields | undefined {
    const resolved = this.resolveCustomerAddress(org);
    if (!resolved) return undefined;
    if (resolved.source !== 'fiscal') {
      this.logger.warn(
        `La organización ${org?.id ?? 'sin id'} no tiene dirección fiscal utilizable; ` +
          `la factura de suscripción declarará la dirección de origen «${resolved.source}» ` +
          `(municipio ${resolved.address.city_code ?? 'sin código'} — ${
            resolved.address.city_name ?? 'sin nombre'
          }).`,
      );
    }
    return resolved.address;
  }

  private buildProviderData(
    invoice: SubscriptionInvoiceForFiscal,
    fiscalNumber: string,
    resolution: PlatformInvoiceResolution,
  ): ProviderInvoiceData {
    // Fecha de firma. La DIAN exige que la fecha del documento sea igual a la
    // fecha de firma, no a la fecha de creación de la factura SaaS. Una factura
    // creada en mayo y pagada en agosto se firma hoy, con `issue_date` de hoy.
    // El periodo del servicio facturado viaja en `invoice_period` (más abajo)
    // y se conserva en la línea, no en el header.
    const issuedAt = new Date();
    const org = invoice.store_subscription.store.organizations;

    // Las dos fechas se resuelven UNA vez y en la zona del obligado a facturar
    // (Vendix), porque la forma de pago se decide comparándolas: `'2'` crédito
    // cuando el vencimiento es posterior a la emisión.
    const issueDate = localDateString(issuedAt, PLATFORM_TIMEZONE);
    const dueDate = localDateString(invoice.due_at, PLATFORM_TIMEZONE);

    // DESCUENTO A NIVEL DE DOCUMENTO — única lectura válida del crédito por
    // cambio a plan inferior. Antes estaba fijado en `'0.00'`, así que el crédito
    // sólo existía como línea negativa: la DIAN recompone bruto, base y total
    // desde las líneas, y una línea negativa descuadra los tres (DAU02 / DAU04 /
    // DAU06). Acá alimenta el `cac:AllowanceCharge` de documento.
    const documentDiscount = resolveSubscriptionDocumentDiscount(
      invoice.metadata,
    );

    const items = this.buildProviderItems(invoice, documentDiscount);

    // El importe de impuestos de la CABECERA se deriva de las filas declaradas,
    // no de la columna: si las dos discreparan, el documento diría en el total
    // legal algo distinto de lo que desglosa. Con el servicio excluido ambas son
    // cero, y el cero queda EXPLICADO por la leyenda de `notes`.
    const taxes = this.buildTaxRows(invoice);
    const taxTotal = this.money(
      taxes.reduce(
        (acc, row) => acc.plus(new Prisma.Decimal(row.tax_amount)),
        DECIMAL_ZERO,
      ),
    );

    // BRUTO DECLARADO: la misma función con la que el emisor calculará
    // `cbc:LineExtensionAmount` y el `ValFac` del CUFE, para que la cabecera de
    // este payload no pueda diferir de lo que el XML publique.
    const grossAmount = dianLineExtensionTotal(items);
    this.warnIfDocumentTotalDoesNotClose(
      invoice,
      grossAmount,
      taxTotal,
      documentDiscount,
    );

    return {
      invoice_number: fiscalNumber,
      invoice_type: 'sales_invoice',
      // The platform is the DIAN obligado here, so its own timezone governs:
      // date and offset must come from the same tz-aware conversion, never from
      // a UTC clock with an offset appended (that names a different instant and
      // silently rolls the day between 00:00Z and the offset).
      issue_date: issueDate,
      issue_time: localTimeString(issuedAt, PLATFORM_TIMEZONE),
      due_date: dueDate,
      /**
       * PERÍODO REALMENTE FACTURADO. Sin este campo el builder derivaba el grupo
       * `cac:InvoicePeriod` de `issue_date` → `due_date`, o sea publicaba
       * «emisión → vencimiento (+7 d)»: en una factura de ciclo mensual eso
       * declara un mes de servicio de siete días. Las dos fechas se resuelven en
       * la zona del obligado, no con el reloj del proceso.
       */
      invoice_period: {
        start_date: localDateString(invoice.period_start, PLATFORM_TIMEZONE),
        end_date: localDateString(invoice.period_end, PLATFORM_TIMEZONE),
      },
      customer_name: org?.legal_name ?? org?.name ?? invoice.store_subscription.store.name,
      // NOT onlyDigits: most rows store the NIT with the DV inline, and
      // concatenating them yields a document number that belongs to nobody.
      customer_tax_id: org ? this.splitCustomerNit(org).number : undefined,
      // El BRUTO de las líneas, no `subscription_invoices.subtotal` —que ya viene
      // NETO del crédito—. Es la cifra que el documento declara como
      // `TaxExclusiveAmount`, y publicar acá la neta contra líneas brutas dejaba
      // el payload contradiciéndose consigo mismo.
      subtotal_amount: grossAmount,
      discount_amount: documentDiscount,
      tax_amount: taxTotal,
      withholding_amount: '0.00',
      total_amount: this.money(invoice.total),
      currency: invoice.currency,
      items,
      // Arreglo VACÍO, nunca una fila al 0 %: el servicio está EXCLUIDO del IVA,
      // y un ítem excluido no informa el grupo de impuestos (FAX01), mientras uno
      // EXENTO sí lo informa con `cbc:Percent` en 0,00. Ver `buildTaxRows`.
      taxes,
      // Trazabilidad + LEYENDA DE EXCLUSIÓN, compuestas por el contrato fiscal.
      // Antes sólo iba la trazabilidad: un IVA en cero sin leyenda no distingue
      // «excluido por ley» de «se olvidó calcularlo».
      notes: buildSubscriptionInvoiceNotes(invoice.invoice_number),
      customer_email: org?.email ?? undefined,
      customer_address: this.buildCustomerAddress(org),
      // Read the adquiriente's real fiscal identity. The previous code inferred
      // '31'/'13' from the mere presence of a tax_id and hardcoded regime '49',
      // which mislabels every responsable de IVA. Falling back only when the
      // field is genuinely absent keeps old rows transmitting as before.
      customer_document_type:
        org?.document_type ?? (org?.tax_id ? '31' : '13'),
      customer_verification_digit:
        (org?.document_type === '31' || org?.document_type === 'NIT') && org
          ? this.splitCustomerNit(org).dv
          : undefined,
      customer_person_type: org?.person_type ?? undefined,
      // `customer_regime` NO declara el régimen de IVA del adquiriente, pese al
      // nombre. Alimenta `normalizePartyAccountType`, que produce '1' o '2' para
      // `cbc:AdditionalAccountID` (Persona Jurídica / Natural) y decide por
      // `document_type` cuando el valor no es reconocible — así que con un NIT
      // (document_type '31') devuelve '1' tanto para '49' como para 'COMUN'.
      //
      // El régimen de IVA del adquiriente viaja por otro camino:
      // `cbc:TaxLevelCode`, que el builder construye desde
      // `customer_tax_responsibilities?.[0] || 'R-99-PN'` (ubl-common.builder.ts).
      // Ver también su nota: «The tax regime ('48'/'49') belongs in TaxLevelCode,
      // not here.»
      //
      // Por eso el default '49' no declara nada falso, y derivarlo con
      // `isVatResponsible` no cambiaría el XML: parecería un arreglo sin serlo.
      customer_regime: org?.tax_regime ?? '49',
      customer_tax_responsibilities: org?.fiscal_responsibilities?.length
        ? org.fiscal_responsibilities
        : undefined,
      // FORMA de pago — `cac:PaymentMeans/cbc:ID`. La factura de suscripción vence
      // a +7 días de la emisión, así que es una venta A CRÉDITO (`'2'`). Estaba
      // fijada en `'1'` (contado), que se contradecía con el `cbc:PaymentDueDate`
      // futuro que el propio documento publica.
      //
      // El vencimiento a crédito queda cubierto con `due_date`: el builder emite
      // `cac:PaymentMeans/cbc:PaymentDueDate` incondicionalmente, así que no hace
      // falta `cac:PaymentTerms` —ningún builder del repositorio lo emite—.
      payment_form: resolveSubscriptionPaymentForm(issueDate, dueDate),
      // MEDIO de pago — `cbc:PaymentMeansCode`, «con qué instrumento». Pago manual
      // ⇒ `'42'` consignación bancaria; Wompi y el resto ⇒ `'1'` instrumento no
      // definido, porque Wompi multiplexa tarjeta, PSE, Nequi y transferencia y el
      // instrumento concreto no se persiste.
      payment_means: resolveSubscriptionPaymentMeans(
        invoice.payments[0]?.payment_method,
      ),
      // Campo INERTE: ningún builder lo lee. Se conserva por trazabilidad interna
      // del payload; el instrumento que viaja al XML es `payment_means`.
      payment_method: invoice.payments[0]?.payment_method ?? 'subscription',
      order_reference: invoice.invoice_number,
      // LOS TRES CAMPOS DE NUMERACIÓN, que antes no viajaban.
      //
      // `technical_key` es obligatorio para la factura electrónica de venta: el
      // proveedor lanza sin ella (guarda de ClTec en `dian-direct.provider.ts`), así
      // que la emisión SaaS moría antes de llegar a la DIAN. `control` es el bloque
      // de autorización: sin su prefijo desaparece el lado derecho de FAB10a y la
      // DIAN rechaza en cascada por FAD05e, FAB24a y FAB27b.
      //
      // Los tres salen de la MISMA fila de resolución que consumió el consecutivo,
      // no de tres lecturas distintas, para que el número emitido y la autorización
      // declarada no puedan pertenecer a resoluciones diferentes.
      resolution_number: resolution.resolution_number ?? undefined,
      // Por la bóveda, no por la columna plana: es la MISMA lectura que hace
      // `invoice-flow.service.ts` al hashear el CUFE. Leer aquí la plana y allá
      // la cifrada es cómo se llega a que el documento se firme con una clave
      // y se declare con otra.
      technical_key: this.technicalKeyVault.reveal(resolution) ?? undefined,
      control: resolveInvoiceControl(resolution, PLATFORM_TIMEZONE, issuedAt, {
        resolution_id: resolution.id,
        document_type: resolution.document_type,
      }),
    };
  }

  /**
   * Tributos que declara una factura de suscripción: NINGUNO.
   *
   * El servicio de computación en la nube está EXCLUIDO del impuesto sobre las
   * ventas por el artículo 476 numeral 21 del Estatuto Tributario (adicionado por
   * la Ley 1819 de 2016; DIAN Concepto Unificado 017056 de 2017 y Oficio 900930 de
   * 2022). La exclusión aplica al PROVEEDOR del servicio, y Vendix lo es.
   *
   * EXCLUIDO ≠ EXENTO. Un ítem excluido NO informa el grupo de impuestos (regla
   * FAX01, espejo CAX01); uno exento SÍ lo informa, con `cbc:Percent` en 0,00. Por
   * eso el arreglo va vacío en vez de llevar una fila de IVA al 0 %: la fila
   * afirmaría que la operación está gravada a tarifa cero, que es otra figura
   * jurídica. Quien DICE por qué no hay impuesto es la leyenda de `notes`.
   *
   * `subscription_invoices.tax_amount` se escribe siempre en cero, así que un
   * valor distinto significa que alguien empezó a gravar este riel sin recorrer
   * las 8 capas del contrato de `tax_type`. Se avisa en vez de dejarlo caer en
   * silencio: emitirlo con el arreglo vacío descuadraría el total legal.
   */
  private buildTaxRows(
    invoice: SubscriptionInvoiceForFiscal,
  ): ProviderInvoiceTax[] {
    const tax = new Prisma.Decimal(invoice.tax_amount ?? 0);
    if (tax.greaterThan(DECIMAL_ZERO)) {
      this.logger.warn(
        `La factura SaaS ${invoice.invoice_number} trae tax_amount=${tax.toFixed(2)} ` +
          'pero el servicio de suscripción está excluido del IVA (art. 476 num. 21 ET). ' +
          'No se declara ningún tributo; revisa el origen antes de transmitir.',
      );
    }
    return [];
  }

  /**
   * Líneas que el documento declara, en la forma que consume el emisor.
   *
   * REGLA CRÍTICA — CIERRA EL DOBLE DESCUENTO. Se descarta toda línea cuyo importe
   * sea menor o igual a cero. Las facturas emitidas ANTES del contrato fiscal
   * traen el crédito por cambio de plan DOS veces: como línea negativa y como
   * `metadata.credit_applied`. Declarar las dos resta el crédito dos veces —el
   * bruto que la DIAN recompone desde las líneas ya viene neto y encima se le
   * aplica el `AllowanceCharge` de documento— y el documento se rechaza por DAU06.
   *
   * Con la regla, los dos formatos convergen en la misma aritmética:
   * `Σ líneas positivas − descuento_de_documento = total` persistido.
   */
  private buildProviderItems(
    invoice: SubscriptionInvoiceForFiscal,
    documentDiscount: string,
  ): UblDocumentLine[] {
    const plan = invoice.store_subscription.plan;
    const declared: UblDocumentLine[] = [];

    for (const item of this.readPersistedLineItems(invoice.line_items)) {
      const line = this.buildProviderItem(item, invoice);
      if (line) declared.push(line);
    }
    if (declared.length > 0) return declared;

    // RESPALDO: la factura no tiene ninguna línea declarable (JSON vacío, o sólo
    // la línea negativa del crédito). Se declara UNA línea por el BRUTO —el total
    // persistido MÁS el descuento— para que el `AllowanceCharge` de documento
    // tenga sobre qué aplicarse y el total legal siga cerrando en `total`.
    // Publicar acá el neto restaría el crédito por segunda vez.
    const gross = new Prisma.Decimal(invoice.total).plus(documentDiscount);
    return [
      {
        description: buildSubscriptionLineDescription({
          planName: plan?.name ?? plan?.code ?? 'Vendix',
          billingCycle: plan?.billing_cycle,
          periodStart: invoice.period_start,
          periodEnd: invoice.period_end,
          prorated: this.isProratedInvoice(invoice.metadata),
        }),
        quantity: '1',
        unit_price: this.money(gross),
        discount_amount: '0.00',
        tax_amount: '0.00',
        total_amount: this.money(gross),
        item_code: buildSubscriptionItemCode(plan?.code),
        unit_code: dianUnitCodeForBillingCycle(plan?.billing_cycle),
        omit_tax_total: true,
      },
    ];
  }

  /**
   * Una línea persistida traducida a línea del documento, o `null` cuando no debe
   * declararse.
   *
   * `item_code` y `unit_code` PREFIEREN lo que trae la línea; los helpers del
   * contrato son el respaldo para las facturas emitidas antes de que esos campos
   * existieran. La descripción llega ya en español desde el origen y no se
   * reconstruye: el respaldo sólo actúa si viene vacía.
   */
  private buildProviderItem(
    item: Partial<InvoiceLineItem>,
    invoice: SubscriptionInvoiceForFiscal,
  ): UblDocumentLine | null {
    const plan = invoice.store_subscription.plan;
    const quantity =
      this.decimalOrNull(item.quantity) ?? new Prisma.Decimal(1);
    const unitPrice = this.decimalOrNull(item.unit_price);
    const total =
      this.decimalOrNull(item.total) ?? unitPrice?.times(quantity) ?? null;

    // REGLA CRÍTICA: la línea negativa del crédito (y cualquier línea en cero) no
    // se declara. Una línea cuyo importe no se puede leer tampoco: declararla con
    // el total de la factura, como se hacía, publica el documento entero sobre una
    // línea cuyo importe se desconoce.
    if (!total || total.lessThanOrEqualTo(DECIMAL_ZERO)) return null;

    const declaredPrice =
      unitPrice ?? (quantity.isZero() ? total : total.div(quantity));

    return {
      description:
        (item.description ?? '').trim() ||
        buildSubscriptionLineDescription({
          planName: plan?.name ?? plan?.code ?? 'Vendix',
          billingCycle: item.meta?.billing_cycle ?? plan?.billing_cycle,
          periodStart: invoice.period_start,
          periodEnd: invoice.period_end,
          prorated: item.meta?.prorated,
        }),
      quantity: quantity.toString(),
      unit_price: this.money(declaredPrice),
      // El descuento de esta factura es de DOCUMENTO, no de línea: repetirlo acá
      // lo restaría dos veces (`documentDiscount` = descuento declarado − Σ
      // descuentos de línea).
      discount_amount: '0.00',
      tax_amount: '0.00',
      total_amount: this.money(total),
      // Código de catálogo estable por plan (`schemeID="999"`). Sin él el XML
      // publica el NÚMERO DE LÍNEA como identificación del ítem.
      item_code: item.item_code?.trim() || buildSubscriptionItemCode(plan?.code),
      // Unidad que califica la cantidad: mes `LUN`, año `ANA`. NO son `MON`/`ANN`
      // —la DIAN publicó la lista UN/ECE con los códigos traducidos y su validador
      // compara la lista corrompida—; `toDianUnitCode` degradaría esos dos a `EA`
      // en silencio y la línea declararía «1 unidad».
      unit_code:
        item.unit_code?.trim() ||
        dianUnitCodeForBillingCycle(item.meta?.billing_cycle ?? plan?.billing_cycle),
      // Toda línea de suscripción está EXCLUIDA del IVA, así que NO emite el grupo
      // `cac:TaxTotal` de línea (FAX01).
      //
      // El respaldo es `true` y no `false` a propósito: las facturas emitidas antes
      // de este contrato no traen la bandera, y su ausencia significa «se emitió
      // antes de que el dato existiera», no «grava». Emitir el grupo en cero
      // afirmaría un ítem EXENTO, que es otra figura. Sólo una línea que declare
      // explícitamente `vat_excluded: false` volvería a informarlo.
      omit_tax_total: item.vat_excluded !== false,
    };
  }

  /**
   * `subscription_invoices.line_items` leído como lo que promete ser.
   *
   * Es JSON sin tipar en la base, así que el tipo es una PROMESA de forma y no una
   * garantía del motor: cada campo se lee después con guardas. El cast vive UNA
   * vez y acá —igual que en el emisor de la factura y en el PDF— en vez de
   * repartirse como `Record<string, any>` por todo el armado del payload.
   */
  private readPersistedLineItems(
    value: Prisma.JsonValue,
  ): Array<Partial<InvoiceLineItem>> {
    if (!Array.isArray(value)) return [];
    return value.filter(
      (entry): entry is Prisma.JsonObject =>
        !!entry && typeof entry === 'object' && !Array.isArray(entry),
    ) as unknown as Array<Partial<InvoiceLineItem>>;
  }

  /**
   * `metadata.prorated`, con guardas. Sólo alimenta el respaldo de la descripción:
   * una factura de prorrateo descrita como ciclo completo declararía un período de
   * servicio que no se prestó.
   */
  private isProratedInvoice(metadata: Prisma.JsonValue): boolean {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return false;
    }
    return (
      (metadata as Record<keyof SubscriptionInvoiceMetadata, unknown>)
        .prorated === true
    );
  }

  /**
   * `Prisma.Decimal` de un valor del JSON, o `null` si no es un número legible.
   *
   * Devolver `null` en vez de cero es deliberado: un cero silencioso convierte un
   * dato ilegible en un importe válido, y el importe de una línea es justo lo que
   * la DIAN recompone.
   */
  private decimalOrNull(value: unknown): Prisma.Decimal | null {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    try {
      const decimal = new Prisma.Decimal(value);
      return decimal.isFinite() ? decimal : null;
    } catch {
      return null;
    }
  }

  /**
   * Comprueba el cierre aritmético que la DIAN recompone:
   * `Σ líneas + impuestos − descuento de documento = total`.
   *
   * No lanza. La emisión ya tiene una red DURA aguas abajo —el proveedor recomputa
   * el CUFE contra el XML y aborta antes de firmar si el `PayableAmount` no coincide
   * con el total hasheado—, y lanzar acá rompería la confirmación del pago que
   * dispara la emisión automática. Lo que aporta esta comprobación es NOMBRAR las
   * dos cifras y el descuento en el log, porque el rechazo aguas abajo dice que no
   * cuadra pero no de dónde salió cada número.
   */
  private warnIfDocumentTotalDoesNotClose(
    invoice: SubscriptionInvoiceForFiscal,
    grossAmount: string,
    taxTotal: string,
    documentDiscount: string,
  ): void {
    const declared = new Prisma.Decimal(grossAmount)
      .plus(taxTotal)
      .minus(documentDiscount);
    const persisted = new Prisma.Decimal(this.money(invoice.total));
    if (declared.equals(persisted)) return;
    this.logger.warn(
      `La factura SaaS ${invoice.invoice_number} no cierra: las líneas declaradas suman ` +
        `${grossAmount} + ${taxTotal} de impuestos − ${documentDiscount} de descuento = ` +
        `${declared.toFixed(2)}, y el total persistido es ${persisted.toFixed(2)}. ` +
        'La DIAN recompone el total desde las líneas, así que el documento se rechazaría.',
    );
  }

  /**
   * Marca la transmisión como enviada, PERO sólo si todavía puede enviarse.
   *
   * Era un `update` plano: escribía `submitted` sobre cualquier estado, incluido
   * `accepted`. Dos emisiones concurrentes sobre la misma factura —el cron
   * automático y un reintento manual, por ejemplo— dejaban la segunda pisando el
   * `accepted` de la primera, y a partir de ahí la factura ya aceptada por la
   * DIAN figuraba como en vuelo: se reintenta, se vuelve a enviar el mismo CUFE
   * y se pierde la única marca que decía «esto ya está bien».
   *
   * `updateMany` con `notIn` + verificación del `count` convierte la escritura en
   * una comprobación: si nadie cambió nada, es que la transmisión ya estaba en un
   * estado terminal y quien llamó tiene que enterarse, no seguir. Espejo de
   * `fiscal-transmission-ledger.service.ts:121-141`, que es donde el carril de
   * tiendas resolvió lo mismo.
   */
  private async markSubmitted(transmissionId: number): Promise<void> {
    const updated = await this.prisma
      .withoutScope()
      .fiscal_transmissions.updateMany({
        where: {
          id: transmissionId,
          transmission_status: { notIn: ['accepted', 'cancelled'] },
        },
        data: {
          transmission_status: 'submitted',
          sent_at: new Date(),
          updated_at: new Date(),
        },
      });

    if (updated.count === 1) return;

    // Cero filas: o la transmisión no existe, o ya es terminal. Se relee para
    // decirlo con precisión — «no se pudo marcar» sin el estado obliga a abrir la
    // base de datos para entender qué pasó.
    const current = await this.prisma
      .withoutScope()
      .fiscal_transmissions.findUnique({
        where: { id: transmissionId },
        select: { transmission_status: true },
      });

    throw new VendixHttpException(
      ErrorCodes.SUBSCRIPTION_FISCAL_001,
      current
        ? `La transmisión ${transmissionId} ya está en estado «${current.transmission_status}» y no se puede volver a enviar. ` +
          'Una transmisión aceptada por la DIAN no se reenvía: emite una nota crédito si hay que corregirla.'
        : `La transmisión ${transmissionId} no existe.`,
      {
        transmission_id: transmissionId,
        transmission_status: current?.transmission_status ?? null,
      },
    );
  }

  private async markAccepted(
    transmissionId: number,
    response: ProviderResponse,
  ): Promise<void> {
    const updated = await this.prisma.withoutScope().fiscal_transmissions.update({
      where: { id: transmissionId },
      data: {
        transmission_status: 'accepted',
        dian_status: 'accepted',
        accounting_status: 'provisional',
        tracking_id: response.tracking_id,
        cufe: response.cufe,
        qr_code: response.qr_code,
        xml_document: response.xml_document,
        pdf_url: response.pdf_url,
        xml_hash: response.xml_document ? this.hash(response.xml_document) : undefined,
        provider_response: response.provider_data ?? response,
        accepted_at: new Date(),
        updated_at: new Date(),
      },
    });
    await this.createEvidences(updated, response);
    await this.emitInvoiceAccepted(updated);
  }

  /**
   * Emite `invoice.accepted` para que `AccountingEventsListener` genere el
   * asiento contable de la factura de plataforma. El contrato del listener es
   * el mismo del riel tienda (DR CxC / CR revenue + tax_payable), solo que acá
   * `store_id` es undefined y `organization_id` es la organización plataforma
   * (id=1 hoy). El subflujo `invoicing` se rige por el área fiscal maestra del
   * mismo nombre, NO por `module_flows.accounting.*`, así que basta con que
   * `fiscal_status.invoicing.state` esté en ACTIVE/LOCKED.
   *
   * Total/subtotal/tax_amount vienen del snapshot `platform_invoice_snapshot`
   * que escribió `createEvidences` (escrito apenas arriba, en esta misma tx).
   * Si el snapshot no existe (algo falló aguas arriba) NO emitimos — un asiento
   * con totales en cero no representa la venta. El error se loguea: la factura
   * quedó aceptada por la DIAN, pero sin asiento; el caller debe enterarse.
   *
   * `counterpart_account_code` y `items[].account_code` son la regla de
   * precedencia del operador sobre el mapeo automático — se leen top-level del
   * metadata del snapshot. Si no están (campo aún no agregado al snapshot),
   * `AutoEntryService` cae al default 1305 / `invoice.validated.revenue`,
   * idéntico al riel tienda.
   */
  private async emitInvoiceAccepted(transmission: {
    id: number;
    organization_id: number;
    store_id: number | null;
    accounting_entity_id: number | null;
    document_number: string;
    created_by_user_id: number | null;
  }): Promise<void> {
    try {
      const snapshot = await this.persistence.loadInvoiceSnapshot(
        this.prisma.withoutScope(),
        transmission.id,
      );
      if (!snapshot) {
        this.logger.error(
          `Cannot emit invoice.accepted for platform transmission #${transmission.id}: ` +
            `no platform_invoice_snapshot evidence found. The DIAN accepted the invoice ` +
            `but no accounting entry will be posted.`,
        );
        return;
      }

      const counterpart_account_code =
        (snapshot as any).counterpart_account_code ?? null;

      const items = Array.isArray(snapshot.items) ? snapshot.items : [];
      const item_account_codes = items
        .map((it) => (it as any)?.account_code ?? null)
        .filter((c): c is string => typeof c === 'string');

      const withholding_breakdown = Array.isArray(snapshot.withholdings)
        ? (snapshot.withholdings as unknown as Array<{
            tax_type?: string;
            amount?: number;
            [k: string]: unknown;
          }>)
        : undefined;

      // `tax_breakdown` por línea no existe todavía en el snapshot V1; el
      // listener y `AutoEntryService` toleran su ausencia cayendo al mapping key
      // legacy `invoice.validated.vat_payable` (suma simple). El contrato
      // formal de `tax_breakdown` se completará cuando `elon` lo agregue al
      // snapshot — el campo es optional en el listener.
      const payload = {
        invoice_id: transmission.id,
        invoice_number: transmission.document_number,
        organization_id: transmission.organization_id,
        store_id: transmission.store_id ?? undefined,
        accounting_entity_id: transmission.accounting_entity_id ?? undefined,
        subtotal_amount: Number(snapshot.totals?.subtotal ?? 0),
        tax_amount: Number(snapshot.totals?.tax_amount ?? 0),
        total_amount: Number(snapshot.totals?.total ?? 0),
        withholding_breakdown,
        user_id: transmission.created_by_user_id ?? undefined,
        customer: snapshot.customer as { id: number; name?: string; tax_id?: string } | undefined,
        // Regla de precedencia: cuenta del operador > mapeo automático.
        counterpart_account_code,
        // Lista de cuentas de ingreso declaradas por línea (para asientos
        // multi-crédito). Vacío hoy = cae a `invoice.validated.revenue`.
        item_account_codes,
      };

      this.eventEmitter.emit('invoice.accepted', payload);
      this.logger.log(
        `Emitted invoice.accepted for platform transmission #${transmission.id} ` +
          `(invoice ${transmission.document_number}, ` +
          `subtotal=${payload.subtotal_amount} tax=${payload.tax_amount} ` +
          `total=${payload.total_amount}` +
          (counterpart_account_code ? `, counterpart=${counterpart_account_code}` : '') +
          `)`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to emit invoice.accepted for platform transmission #${transmission.id}: ` +
          `${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  private async markRejected(
    transmissionId: number,
    response: ProviderResponse,
  ): Promise<void> {
    await this.prisma.withoutScope().fiscal_transmissions.update({
      where: { id: transmissionId },
      data: {
        transmission_status: 'rejected',
        dian_status: 'rejected',
        accounting_status: 'blocked',
        tracking_id: response.tracking_id,
        cufe: response.cufe,
        qr_code: response.qr_code,
        xml_document: response.xml_document,
        pdf_url: response.pdf_url,
        provider_response: response.provider_data ?? response,
        error_message: response.message,
        rejected_at: new Date(),
        updated_at: new Date(),
      },
    });
  }

  private async markError(transmissionId: number, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    await this.prisma.withoutScope().fiscal_transmissions.update({
      where: { id: transmissionId },
      data: {
        transmission_status: 'error',
        dian_status: 'error',
        accounting_status: 'blocked',
        error_code: 'SUBSCRIPTION_FISCAL_ISSUE_FAILED',
        error_message: message,
        updated_at: new Date(),
      },
    });
  }

  private async createEvidences(transmission: any, response: ProviderResponse) {
    const values: any[] = [];
    if (response.xml_document) {
      values.push(this.evidence(transmission, 'xml_signed', response.xml_document));
    }
    if (response.pdf_url) {
      values.push(this.evidence(transmission, 'pdf', response.pdf_url));
    }
    if (response.qr_code) {
      values.push(this.evidence(transmission, 'qr', response.qr_code));
    }
    values.push(this.evidence(transmission, 'dian_response', response));
    await this.prisma.withoutScope().fiscal_evidences.createMany({
      data: values,
      skipDuplicates: true,
    });
  }

  private evidence(transmission: any, evidenceType: string, value: unknown) {
    return {
      organization_id: transmission.organization_id,
      store_id: transmission.store_id,
      accounting_entity_id: transmission.accounting_entity_id,
      fiscal_transmission_id: transmission.id,
      evidence_type: evidenceType,
      content_hash: this.hash(value),
      metadata: typeof value === 'string' ? { value } : (value as any),
      created_by_user_id: transmission.created_by_user_id,
    };
  }

  /**
   * Anexo Técnico 1.9 §11.2 requires amounts TRUNCATED to 2 decimals, not
   * rounded — `toFixed(2)` alone turns 1000.005 into '1000.01' and can diverge
   * a cent from the DIAN's own recomputation of the CUFE.
   */
  private money(value: Prisma.Decimal.Value | null | undefined): string {
    return dianAmount(value ?? 0);
  }

  private onlyDigits(value?: string | null): string | undefined {
    const digits = String(value ?? '').replace(/\D/g, '');
    return digits || undefined;
  }

  /**
   * Splits `organizations.tax_id` into the DIAN document number and its DV.
   *
   * Most rows store the NIT with the DV already inline (`800987654-3`) — every
   * organization with a NIT in dev does. Stripping non-digits would produce
   * `8009876543`, a ten-digit "NIT" that is not the company's, so the
   * adquiriente on the invoice would be a party that does not exist.
   *
   * The DV is always the derived one. It is a checksum of the number, so any
   * stored digit that disagrees is wrong — and some do: the dev seed holds
   * `800987654-3` while the modulo-11 DV of that NIT is 4. A mismatch is logged
   * rather than silently preferred, because it usually means the row's NIT was
   * typed by hand.
   */
  private splitCustomerNit(org: {
    tax_id: string | null;
    verification_digit: string | null;
  }): { number?: string; dv?: string } {
    const parsed = normalizeNit(org.tax_id);
    if (!parsed.number) return {};
    if (parsed.dv_mismatch) {
      this.logger.warn(
        `Acquirer NIT ${parsed.number} carries DV ${parsed.provided_dv} but its modulo-11 DV is ${parsed.dv}; using the derived one`,
      );
    }
    if (
      org.verification_digit &&
      org.verification_digit !== parsed.dv
    ) {
      this.logger.warn(
        `organizations.verification_digit (${org.verification_digit}) disagrees with the DV of NIT ${parsed.number} (${parsed.dv}); using the derived one`,
      );
    }
    return { number: parsed.number, dv: parsed.dv };
  }

  private hash(value: unknown): string {
    return createHash('sha256')
      .update(typeof value === 'string' ? value : JSON.stringify(value ?? {}))
      .digest('hex');
  }
}
