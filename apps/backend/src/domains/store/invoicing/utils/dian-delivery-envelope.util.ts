/**
 * ENVOLTURA DEL CORREO DE ENTREGA DE UN DOCUMENTO ELECTRÓNICO.
 *
 * Reúne en un solo lugar lo que tres flujos necesitan por igual —el reenvío /
 * envío automático de tienda (`InvoiceDeliveryService.deliver`, que también
 * ejecuta el listener `invoice.pdf.generated`) y el reenvío de facturas de
 * plataforma (`PlatformDeliveryService`)—: quién es el EMISOR, con qué ASUNTO
 * sale el correo, con qué REMITENTE visible y cómo se NOMBRA el zip.
 *
 * Fuente normativa: Anexo Técnico FEV 1.9, §9.1 (asunto de 5/6 campos separados
 * por «;», ver `dian-email-subject.util.ts`) y §6.5.7 (nombre del zip, ver
 * `dian-file-naming.util.ts`).
 *
 * DECISIÓN — CONSECUTIVO DEL ZIP. El nombre DIAN del zip lleva un consecutivo
 * de paquete (`dddddddd`, 8 hex). Al ENVIAR a la DIAN ese valor es el
 * consecutivo del primer documento del lote. En una ENTREGA al adquiriente no
 * hay lote ni secuencia de paquetes (y crear una secuencia nueva exigiría
 * migración, que está fuera de alcance), así que el consecutivo se DERIVA de
 * forma determinística del número del documento entregado
 * (`consecutiveFromDocumentNumber`: la corrida final de dígitos de `cbc:ID`).
 * Consecuencia buscada: reenviar el mismo documento produce SIEMPRE el mismo
 * nombre, y el nombre sigue siendo rastreable hasta su factura. NIT y año salen
 * del emisor y de la fecha de emisión del documento (no del reloj).
 *
 * TODO es no-fatal: si la identidad no se resuelve, el llamador cae al asunto,
 * remitente y nombre de zip anteriores. Un correo con la factura del cliente
 * nunca se pierde por un hueco de identidad.
 */
import { invoice_type_enum } from '@prisma/client';
import { tryResolveTenantFiscalIdentity } from '@common/helpers/fiscal-identity.helper';
import {
  buildDianEmailSubject,
  resolveDianDocumentTypeCode,
} from './dian-email-subject.util';
import {
  buildDianZipFileName,
  consecutiveFromDocumentNumber,
  softwareCodeForOperationMode,
} from './dian-file-naming.util';

/** Identidad del emisor tal como la necesita el correo. */
export interface DeliveryIssuerIdentity {
  /** NIT sin DV (forma de `cbc:CompanyID`). */
  nit: string;
  /** Razón social (`cbc:RegistrationName`). */
  legal_name: string;
  /** Nombre comercial; cae a la razón social en el asunto si falta. */
  trade_name?: string;
  /** Correo de contacto del emisor (Reply-To). */
  email?: string;
}

/** Fuente mínima: la fila de organización y, si aplica, la de tienda. */
export interface DeliveryIssuerSource {
  organization?: {
    name?: string | null;
    legal_name?: string | null;
    tax_id?: string | null;
    email?: string | null;
    phone?: string | null;
    fiscal_scope?: string | null;
    document_type?: string | null;
    person_type?: string | null;
    organization_settings?: { settings?: unknown } | null;
  } | null;
  store?: {
    name?: string | null;
    legal_name?: string | null;
    tax_id?: string | null;
    store_settings?: { settings?: unknown } | null;
  } | null;
}

/**
 * Resuelve la identidad del emisor con el MISMO criterio que el PDF y el XML:
 * bajo `fiscal_scope = 'STORE'` la identidad vive en los ajustes de la tienda;
 * bajo `ORGANIZATION`, en los de la organización. Sin tienda (plataforma) se
 * lee la organización. Devuelve `null` si faltan NIT o razón social.
 */
export function resolveDeliveryIssuerIdentity(
  source: DeliveryIssuerSource,
): DeliveryIssuerIdentity | null {
  try {
    const org = source.organization ?? null;
    const store = source.store ?? null;
    const scope = org?.fiscal_scope ?? 'STORE';
    const use_store = !!store && scope === 'STORE';
    const settings = use_store
      ? store?.store_settings?.settings
      : org?.organization_settings?.settings;
    const owner = use_store ? store : org;

    const { identity } = tryResolveTenantFiscalIdentity({
      nit: org?.tax_id || store?.tax_id || '',
      fiscal_data: ((settings as any)?.fiscal_data ?? null) as Record<
        string,
        unknown
      > | null,
      entity: org ? { legal_name: org.legal_name, name: org.name } : null,
      organization: org
        ? {
            legal_name: org.legal_name,
            name: org.name,
            email: org.email,
            phone: org.phone,
            document_type: org.document_type,
            person_type: org.person_type,
          }
        : null,
      email: org?.email,
    });

    if (!identity.nit || !identity.legal_name) return null;
    return {
      nit: identity.nit,
      legal_name: identity.legal_name,
      trade_name: owner?.name || undefined,
      email: identity.email || org?.email || undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Asunto DIAN (§9.1) o `fallback_subject` si la identidad falta o el builder
 * lanza (campo obligatorio vacío).
 */
export function buildDeliverySubject(params: {
  issuer: DeliveryIssuerIdentity | null;
  document_number: string;
  invoice_type: invoice_type_enum | null | undefined;
  fallback_subject: string;
}): string {
  if (!params.issuer) return params.fallback_subject;
  try {
    return buildDianEmailSubject({
      issuer_nit: params.issuer.nit,
      issuer_legal_name: params.issuer.legal_name,
      document_number: params.document_number,
      document_type_code: resolveDianDocumentTypeCode(params.invoice_type),
      issuer_trade_name: params.issuer.trade_name,
    });
  } catch {
    return params.fallback_subject;
  }
}

/** Remitente visible = razón social del emisor; Reply-To = su correo. */
export function buildDeliverySender(
  issuer: DeliveryIssuerIdentity | null,
): { name: string; email: string } | undefined {
  if (!issuer) return undefined;
  return { name: issuer.legal_name, email: issuer.email ?? '' };
}

/**
 * Nombre DIAN del zip de entrega (`z` + NIT 10 + ppp + aa + consecutivo hex 8)
 * o `fallback_name` si no se puede construir. Ver «DECISIÓN — CONSECUTIVO».
 *
 * `operation_mode` es el de `dian_configurations`; en modo
 * `technological_provider` no hay código `ppp` guardado y se cae a software
 * propio (`000`): aquí el nombre sólo identifica un adjunto de correo, no se
 * somete a la DIAN, así que no se debe bloquear la entrega.
 */
export function buildDeliveryZipName(params: {
  issuer: DeliveryIssuerIdentity | null;
  document_number: string;
  issue_date?: string | Date | null;
  operation_mode?: string | null;
  fallback_name: string;
}): string {
  if (!params.issuer) return params.fallback_name;
  let software_code: string | undefined;
  try {
    software_code = softwareCodeForOperationMode(params.operation_mode);
  } catch {
    software_code = undefined;
  }
  try {
    return buildDianZipFileName({
      nit: params.issuer.nit,
      consecutive: consecutiveFromDocumentNumber(params.document_number),
      software_code,
      year: params.issue_date ?? undefined,
    });
  } catch {
    return params.fallback_name;
  }
}
