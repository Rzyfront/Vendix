import { Prisma } from '@prisma/client';
import {
  DomainDnsInstruction,
  DomainDnsInstructionsPayload,
  DomainProvisioningStage,
  DomainValidationRecord,
  getDomainSslConfig,
} from './domain-custom-hosting.util';

export interface DomainRootHostingRecord {
  id: number;
  hostname: string;
  organization_id?: number | null;
  store_id?: number | null;
  status: string;
  ssl_status: string;
  verification_token?: string | null;
  last_verified_at?: Date | string | null;
  validation_cname_name?: string | null;
  validation_cname_value?: string | null;
  acm_certificate_arn?: string | null;
  certificate_issued_at?: Date | string | null;
  cloudfront_distribution_tenant_id?: string | null;
  cloudfront_distribution_tenant_status?: string | null;
  routing_endpoint?: string | null;
  cloudfront_deployed_at?: Date | string | null;
  last_error?: string | null;
  last_error_code?: string | null;
  config?: Prisma.JsonValue | Prisma.InputJsonValue | null;
}

export interface DomainRootAssignmentRecord {
  id: number;
  hostname: string;
  app_type: string;
  status: string;
  is_primary: boolean;
}

export function getRootWildcardHostname(root: DomainRootHostingRecord): string {
  return `*.${root.hostname}`;
}

export function getRootCertificateDomainNames(
  root: DomainRootHostingRecord,
): string[] {
  return [root.hostname, getRootWildcardHostname(root)];
}

export function getOneLevelRootSubdomainLabel(
  hostname: string,
  rootHostname: string,
): string | null {
  const suffix = `.${rootHostname}`;
  if (!hostname.endsWith(suffix)) return null;

  const label = hostname.slice(0, -suffix.length);
  if (!label || label.includes('.')) return null;
  return label;
}

export function isHostnameCoveredByRoot(
  hostname: string,
  rootHostname: string,
): boolean {
  return (
    hostname === rootHostname ||
    getOneLevelRootSubdomainLabel(hostname, rootHostname) !== null
  );
}

export function getStoredRootValidationRecords(
  root: DomainRootHostingRecord,
): DomainValidationRecord[] {
  const records = getDomainSslConfig(root.config)['validation_records'];
  const normalized: DomainValidationRecord[] = [];

  if (Array.isArray(records)) {
    for (const record of records) {
      if (!record || typeof record !== 'object' || Array.isArray(record)) {
        continue;
      }
      const item = record as Record<string, unknown>;
      const name = item['name'];
      const value = item['value'];
      if (typeof name !== 'string' || typeof value !== 'string') continue;

      normalized.push({
        domain_name:
          typeof item['domain_name'] === 'string'
            ? (item['domain_name'] as string)
            : undefined,
        record_type:
          typeof item['record_type'] === 'string'
            ? (item['record_type'] as string)
            : 'CNAME',
        name,
        value,
        validation_status:
          typeof item['validation_status'] === 'string'
            ? (item['validation_status'] as string)
            : undefined,
      });
    }
  }

  if (
    normalized.length === 0 &&
    root.validation_cname_name &&
    root.validation_cname_value
  ) {
    normalized.push({
      domain_name: root.hostname,
      record_type: 'CNAME',
      name: root.validation_cname_name,
      value: root.validation_cname_value,
    });
  }

  return normalized;
}

export function buildDomainRootDnsInstructions(params: {
  root: DomainRootHostingRecord;
  assignments?: DomainRootAssignmentRecord[];
  verificationToken?: string | null;
  routingEndpoint: string;
}): DomainDnsInstructionsPayload {
  const { root, assignments = [], verificationToken, routingEndpoint } = params;
  const sslConfig = getDomainSslConfig(root.config);
  const certificateStatus =
    typeof sslConfig['aws_certificate_status'] === 'string'
      ? (sslConfig['aws_certificate_status'] as string)
      : undefined;
  const tenantStatus =
    root.cloudfront_distribution_tenant_status ||
    (typeof sslConfig['cloudfront_tenant_status'] === 'string'
      ? (sslConfig['cloudfront_tenant_status'] as string)
      : undefined);
  const httpsProbeStatus =
    typeof sslConfig['https_probe_status'] === 'string'
      ? (sslConfig['https_probe_status'] as 'pending' | 'passed' | 'failed')
      : undefined;

  const ownershipComplete =
    !!root.last_verified_at || root.status !== 'pending_ownership';
  const certificateComplete =
    root.ssl_status === 'issued' || certificateStatus === 'ISSUED';
  const routingComplete =
    typeof sslConfig['routing_status'] === 'string'
      ? sslConfig['routing_status'] === 'complete'
      : false;
  const tenantComplete =
    tenantStatus === 'Deployed' ||
    tenantStatus === 'DeployedWithTenant' ||
    tenantStatus === 'active';
  const httpsComplete =
    httpsProbeStatus === 'passed' || root.status === 'active';

  const instructions: DomainDnsInstruction[] = [];
  const certificateRecords = getStoredRootValidationRecords(root);

  if (!ownershipComplete && verificationToken) {
    instructions.push({
      record_type: 'TXT',
      name: `_vendix-verify.${root.hostname}`,
      provider_host: '_vendix-verify',
      fqdn_name: `_vendix-verify.${root.hostname}`,
      value: verificationToken,
      ttl: 300,
      purpose: 'ownership',
      group: 'ownership',
      scope: 'root',
      status: 'pending',
      status_reason: 'Agrega este TXT para probar que controlas el dominio.',
    });
  }

  for (const record of certificateRecords) {
    const providerHost = toProviderHost(record.name, root.hostname);
    instructions.push({
      record_type: record.record_type || 'CNAME',
      name: record.name,
      provider_host: providerHost,
      fqdn_name: stripTrailingDot(record.name),
      value: stripTrailingDot(record.value),
      ttl: 300,
      purpose: 'certificate',
      group: 'certificate',
      domain_name: record.domain_name,
      scope: record.domain_name?.startsWith('*.') ? 'wildcard' : 'root',
      status: certificateComplete ? 'complete' : 'pending',
      status_reason: certificateComplete
        ? 'El certificado seguro ya fue verificado. Conserva este registro para renovaciones.'
        : 'Agrega este CNAME para emitir el certificado seguro.',
    });
  }

  instructions.push(
    {
      record_type: 'ALIAS/ANAME',
      name: root.hostname,
      provider_host: '@',
      fqdn_name: root.hostname,
      value: routingEndpoint,
      ttl: 300,
      purpose: 'routing',
      group: 'routing',
      scope: 'root',
      status:
        routingComplete || root.status === 'active' ? 'complete' : 'pending',
      routing_target_type: 'cloudfront_distribution',
      status_reason:
        'Apunta el dominio raíz al destino de conexión cuando el certificado esté listo.',
    },
    {
      record_type: 'CNAME',
      name: getRootWildcardHostname(root),
      provider_host: '*',
      fqdn_name: getRootWildcardHostname(root),
      value: routingEndpoint,
      ttl: 300,
      purpose: 'routing',
      group: 'routing',
      scope: 'wildcard',
      status:
        routingComplete || root.status === 'active' ? 'complete' : 'pending',
      routing_target_type: 'cloudfront_distribution',
      status_reason:
        'Permite que Vendix active subdominios de un nivel sin repetir SSL.',
    },
  );

  const stages = buildDomainRootStages({
    ownershipComplete,
    certificateComplete,
    routingComplete,
    tenantComplete,
    httpsComplete,
    hasCertificateRecords: certificateRecords.length > 0,
    certificateStatus,
    tenantStatus,
    httpsProbeStatus,
    rootStatus: root.status,
  });
  const diagnostics =
    root.last_error || root.last_error_code
      ? [
          {
            label: 'Último intento',
            status: 'failed',
            detail: humanizeRootProvisioningError(root.last_error),
          },
        ]
      : undefined;

  return {
    domain_root_id: root.id,
    root_hostname: root.hostname,
    hostname: root.hostname,
    ownership: 'custom_domain',
    dns_type: 'A',
    target: routingEndpoint,
    requires_alias: true,
    ownership_status: ownershipComplete ? 'complete' : 'pending',
    certificate_status: certificateComplete ? 'complete' : 'pending',
    routing_status:
      routingComplete || root.status === 'active' ? 'complete' : 'pending',
    wildcard_hostname: getRootWildcardHostname(root),
    provisioning_stage: inferRootStage(stages),
    stages,
    aws_certificate_status: certificateStatus,
    cloudfront_status: tenantStatus,
    https_probe_status: httpsProbeStatus,
    next_check_at:
      typeof sslConfig['next_check_at'] === 'string'
        ? (sslConfig['next_check_at'] as string)
        : undefined,
    diagnostics,
    assignments,
    instructions,
  };
}

function buildDomainRootStages(params: {
  ownershipComplete: boolean;
  certificateComplete: boolean;
  routingComplete: boolean;
  tenantComplete: boolean;
  httpsComplete: boolean;
  hasCertificateRecords: boolean;
  certificateStatus?: string;
  tenantStatus?: string;
  httpsProbeStatus?: string;
  rootStatus: string;
}): DomainProvisioningStage[] {
  const failed = params.rootStatus.startsWith('failed');

  return [
    {
      key: 'ownership',
      label: 'Propiedad del dominio',
      status: params.ownershipComplete
        ? 'complete'
        : failed
          ? 'failed'
          : 'pending',
      detail: params.ownershipComplete
        ? 'La propiedad del dominio ya fue verificada.'
        : 'Agrega el TXT de propiedad.',
      waiting: !params.ownershipComplete && !failed,
    },
    {
      key: 'certificate',
      label: 'Certificado seguro',
      status: params.certificateComplete
        ? 'complete'
        : failed
          ? 'failed'
          : 'pending',
      detail: params.certificateComplete
        ? 'El certificado ya fue verificado.'
        : params.ownershipComplete && !params.hasCertificateRecords
          ? 'Vendix está generando los CNAME del certificado.'
          : 'Agrega los CNAME del certificado.',
      waiting:
        params.ownershipComplete && !params.certificateComplete && !failed,
    },
    {
      key: 'routing',
      label: 'Enrutamiento DNS',
      status: params.routingComplete
        ? 'complete'
        : failed
          ? 'failed'
          : 'pending',
      detail: params.routingComplete
        ? 'Los DNS apuntan al destino correcto.'
        : 'Apunta el dominio y wildcard al destino de conexión.',
      waiting: params.certificateComplete && !params.routingComplete && !failed,
    },
    {
      key: 'cloudfront',
      label: 'Conexión del dominio',
      status: params.tenantComplete
        ? 'complete'
        : failed
          ? 'failed'
          : 'pending',
      detail: params.tenantComplete
        ? 'La conexión del dominio está lista.'
        : 'Vendix está conectando el dominio.',
      waiting: params.certificateComplete && !params.tenantComplete && !failed,
    },
    {
      key: 'https',
      label: 'Prueba HTTPS',
      status: params.httpsComplete ? 'complete' : failed ? 'failed' : 'pending',
      detail: params.httpsComplete
        ? 'La prueba segura pasó desde internet.'
        : 'Probando que el dominio responda de forma segura.',
      waiting: params.tenantComplete && !params.httpsComplete && !failed,
    },
    {
      key: 'active',
      label: 'Activo',
      status:
        params.rootStatus === 'active'
          ? 'complete'
          : failed
            ? 'failed'
            : 'pending',
      detail:
        params.rootStatus === 'active'
          ? 'El dominio base está listo para crear asignaciones.'
          : 'Aún no uses el dominio como definitivo.',
      waiting: false,
    },
  ];
}

function inferRootStage(stages: DomainProvisioningStage[]) {
  return stages.find((stage) => stage.waiting)?.key ?? 'active';
}

function humanizeRootProvisioningError(error?: string | null): string {
  if (!error) {
    return 'No pudimos completar el último intento. Sincroniza de nuevo en unos minutos.';
  }

  if (
    error.includes('ValidationException') ||
    error.includes('ACM invalid parameter')
  ) {
    return 'No pudimos generar los registros del certificado por una validación interna. Ya puedes reintentar la sincronización.';
  }

  return error;
}

function stripTrailingDot(value: string): string {
  return value.endsWith('.') ? value.slice(0, -1) : value;
}

function toProviderHost(fqdn: string, rootHostname: string): string {
  const clean = stripTrailingDot(fqdn);
  const suffix = `.${rootHostname}`;
  if (clean === rootHostname) return '@';
  if (clean.endsWith(suffix)) return clean.slice(0, -suffix.length);
  return clean;
}
