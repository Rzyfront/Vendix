import { Prisma } from '@prisma/client';
import {
  DnsResolverService,
  ResolverResult,
} from '../dns/dns-resolver.service';

export type DomainInstructionStatus =
  | 'pending'
  | 'complete'
  | 'not_required'
  | 'covered_by_parent';

export type DomainProvisioningStageKey =
  | 'ownership'
  | 'certificate'
  | 'routing'
  | 'cloudfront'
  | 'https'
  | 'active'
  | 'failed';

export type DomainProvisioningStageStatus =
  | 'pending'
  | 'waiting'
  | 'complete'
  | 'failed'
  | 'covered_by_parent'
  | 'not_required';

export interface DomainValidationRecord {
  domain_name?: string;
  record_type: string;
  name: string;
  value: string;
  validation_status?: string;
}

export interface DomainDnsInstruction {
  record_type: string;
  name: string;
  value: string;
  ttl: number;
  purpose?: string;
  group?: 'ownership' | 'certificate' | 'routing';
  status?: DomainInstructionStatus;
  scope?: 'root' | 'wildcard' | 'subdomain' | 'parent';
  covered_by_parent_hostname?: string;
  domain_name?: string;
  provider_host?: string;
  fqdn_name?: string;
  detected_values?: string[];
  seen_in?: string[];
  status_reason?: string;
  routing_target_type?: 'cloudfront_distribution' | 'legacy_edge_alias';
}

export interface DomainProvisioningStage {
  key: DomainProvisioningStageKey;
  label: string;
  status: DomainProvisioningStageStatus;
  detail: string;
  waiting: boolean;
  updated_at?: string;
}

export interface DomainDnsInstructionsPayload {
  domain_root_id?: number;
  root_hostname?: string;
  hostname: string;
  ownership: string;
  dns_type: 'CNAME' | 'A';
  target: string;
  requires_alias?: boolean;
  ownership_status?: DomainInstructionStatus;
  certificate_status?: DomainInstructionStatus;
  routing_status?: DomainInstructionStatus;
  wildcard_hostname?: string;
  covered_by_parent_hostname?: string | null;
  provisioning_stage?: DomainProvisioningStageKey;
  stages?: DomainProvisioningStage[];
  aws_certificate_status?: string;
  cloudfront_status?: string;
  https_probe_status?: 'pending' | 'passed' | 'failed';
  next_check_at?: string;
  diagnostics?: Array<{ label: string; status: string; detail: string }>;
  assignments?: Array<{
    id: number;
    hostname: string;
    app_type: string;
    status: string;
    is_primary: boolean;
  }>;
  instructions: DomainDnsInstruction[];
}

export interface DomainHostingRecord {
  id: number;
  hostname: string;
  ownership: string;
  status: string;
  ssl_status: string;
  config?: Prisma.JsonValue | Prisma.InputJsonValue | null;
  verification_token?: string | null;
  last_verified_at?: Date | string | null;
  validation_cname_name?: string | null;
  validation_cname_value?: string | null;
  cloudfront_deployed_at?: Date | string | null;
  certificate_issued_at?: Date | string | null;
}

const VERIFIED_DOMAIN_STATUSES = new Set([
  'pending_certificate',
  'issuing_certificate',
  'pending_alias',
  'propagating',
  'active',
]);

export function getDomainConfigObject(
  config: Prisma.JsonValue | Prisma.InputJsonValue | null | undefined,
): Record<string, unknown> {
  if (config && typeof config === 'object' && !Array.isArray(config)) {
    return { ...(config as Record<string, unknown>) };
  }

  return {};
}

export function getDomainSslConfig(
  config: Prisma.JsonValue | Prisma.InputJsonValue | null | undefined,
): Record<string, unknown> {
  const configObject = getDomainConfigObject(config);
  const ssl = configObject['ssl'];

  if (ssl && typeof ssl === 'object' && !Array.isArray(ssl)) {
    return { ...(ssl as Record<string, unknown>) };
  }

  return {};
}

export function mergeDomainSslConfig(
  config: Prisma.JsonValue | Prisma.InputJsonValue | null | undefined,
  sslPatch: Record<string, unknown>,
): Prisma.InputJsonValue {
  const configObject = getDomainConfigObject(config);
  const ssl = getDomainSslConfig(config);

  return {
    ...configObject,
    ssl: {
      ...ssl,
      ...sslPatch,
    },
  } as Prisma.InputJsonValue;
}

export function isCustomRootDomain(domain: DomainHostingRecord): boolean {
  return domain.ownership === 'custom_domain';
}

export function getWildcardHostname(
  domain: DomainHostingRecord,
): string | null {
  return isCustomRootDomain(domain) ? `*.${domain.hostname}` : null;
}

export function getCertificateDomainNames(
  domain: DomainHostingRecord,
): string[] {
  const wildcardHostname = getWildcardHostname(domain);
  return wildcardHostname
    ? [domain.hostname, wildcardHostname]
    : [domain.hostname];
}

export function getCloudFrontAliasesForDomain(
  domain: DomainHostingRecord,
): string[] {
  return getCertificateDomainNames(domain);
}

export function getInheritedFromHostname(
  domain: DomainHostingRecord,
): string | null {
  const inherited = getDomainSslConfig(domain.config)[
    'inherited_from_hostname'
  ];
  return typeof inherited === 'string' && inherited.length > 0
    ? inherited
    : null;
}

export function hasIssuedWildcardSsl(domain: DomainHostingRecord): boolean {
  const wildcardHostname = getWildcardHostname(domain);
  if (!wildcardHostname) return false;

  const sslConfig = getDomainSslConfig(domain.config);
  return (
    domain.status === 'active' &&
    domain.ssl_status === 'issued' &&
    sslConfig['wildcard_status'] === 'issued' &&
    sslConfig['wildcard_hostname'] === wildcardHostname
  );
}

export function getOneLevelSubdomainLabel(
  hostname: string,
  parentHostname: string,
): string | null {
  const suffix = `.${parentHostname}`;
  if (!hostname.endsWith(suffix)) return null;

  const label = hostname.slice(0, -suffix.length);
  if (!label || label.includes('.')) return null;

  return label;
}

export function buildInheritedDomainConfig(
  config: Prisma.JsonValue | Prisma.InputJsonValue | null | undefined,
  parentDomain: DomainHostingRecord,
): Prisma.InputJsonValue {
  return mergeDomainSslConfig(config, {
    inherited: true,
    inherited_from_domain_id: parentDomain.id,
    inherited_from_hostname: parentDomain.hostname,
    wildcard_hostname: `*.${parentDomain.hostname}`,
    wildcard_status: 'issued',
    certificate_status: 'inherited',
    validation_records: [],
    inherited_at: new Date().toISOString(),
  });
}

export function decorateDomainWithSslFields<T extends DomainHostingRecord>(
  domain: T,
): T & {
  wildcard_ssl_status?: string;
  ssl_inherited_from_hostname?: string | null;
} {
  const sslConfig = getDomainSslConfig(domain.config);
  const inheritedFrom = getInheritedFromHostname(domain);
  const wildcardHostname = getWildcardHostname(domain);
  let wildcardStatus: string | undefined;

  if (wildcardHostname) {
    wildcardStatus =
      typeof sslConfig['wildcard_status'] === 'string'
        ? (sslConfig['wildcard_status'] as string)
        : domain.status === 'active' && domain.ssl_status === 'issued'
          ? 'upgrade_required'
          : 'pending';
  }

  return {
    ...domain,
    wildcard_ssl_status: wildcardStatus,
    ssl_inherited_from_hostname: inheritedFrom,
  };
}

export function getStoredValidationRecords(
  domain: DomainHostingRecord,
): DomainValidationRecord[] {
  const sslConfig = getDomainSslConfig(domain.config);
  const records = sslConfig['validation_records'];
  const normalized: DomainValidationRecord[] = [];

  if (Array.isArray(records)) {
    for (const record of records) {
      if (!record || typeof record !== 'object' || Array.isArray(record)) {
        continue;
      }

      const item = record as Record<string, unknown>;
      const name = item['name'];
      const value = item['value'];

      if (typeof name !== 'string' || typeof value !== 'string') {
        continue;
      }

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
    domain.validation_cname_name &&
    domain.validation_cname_value
  ) {
    normalized.push({
      domain_name: domain.hostname,
      record_type: 'CNAME',
      name: domain.validation_cname_name,
      value: domain.validation_cname_value,
    });
  }

  return dedupeValidationRecords(normalized);
}

export function dedupeValidationRecords(
  records: DomainValidationRecord[],
): DomainValidationRecord[] {
  const seen = new Set<string>();

  return records.filter((record) => {
    const key = `${record.record_type}:${record.name}:${record.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildDomainDnsInstructions(params: {
  domain: DomainHostingRecord;
  edgeHost: string;
  verificationToken?: string | null;
  routingTargetType?: 'cloudfront_distribution' | 'legacy_edge_alias';
  legacyEdgeHost?: string;
}): DomainDnsInstructionsPayload {
  const {
    domain,
    edgeHost,
    verificationToken,
    routingTargetType = 'cloudfront_distribution',
    legacyEdgeHost,
  } = params;
  const sslConfig = getDomainSslConfig(domain.config);
  const inheritedFrom = getInheritedFromHostname(domain);
  const isSubdomain =
    domain.ownership === 'custom_subdomain' ||
    domain.ownership === 'third_party_subdomain' ||
    domain.ownership === 'vendix_subdomain';
  const isVerified =
    !!domain.last_verified_at || VERIFIED_DOMAIN_STATUSES.has(domain.status);
  const routingStatus: DomainInstructionStatus = inheritedFrom
    ? 'covered_by_parent'
    : domain.status === 'active'
      ? 'complete'
      : 'pending';
  const certificateStatus: DomainInstructionStatus = inheritedFrom
    ? 'covered_by_parent'
    : domain.ssl_status === 'issued'
      ? 'complete'
      : 'pending';
  const ownershipStatus: DomainInstructionStatus = inheritedFrom
    ? 'covered_by_parent'
    : isVerified
      ? 'complete'
      : 'pending';
  const instructions: DomainDnsInstruction[] = [];

  if (verificationToken && !inheritedFrom) {
    instructions.push({
      record_type: 'TXT',
      name: `_vendix-verify.${domain.hostname}`,
      value: verificationToken,
      ttl: 300,
      purpose: 'ownership',
      group: 'ownership',
      status: ownershipStatus,
      scope: isSubdomain ? 'subdomain' : 'root',
      status_reason:
        ownershipStatus === 'complete'
          ? 'Vendix ya verificó la propiedad del dominio.'
          : 'Agrega este TXT para demostrar que controlas el dominio.',
    });
  }

  if (!inheritedFrom) {
    for (const record of getStoredValidationRecords(domain)) {
      instructions.push({
        record_type: record.record_type,
        name: record.name,
        value: record.value,
        ttl: 300,
        purpose: 'certificate',
        group: 'certificate',
        status: certificateStatus,
        scope: record.domain_name?.startsWith('*.') ? 'wildcard' : 'root',
        domain_name: record.domain_name,
        status_reason:
          certificateStatus === 'complete'
            ? 'El certificado ya fue verificado. Conserva el CNAME para renovaciones.'
            : 'El certificado necesita ver este CNAME para emitirse y renovarse.',
      });
    }
  }

  if (inheritedFrom) {
    instructions.push({
      record_type: 'CNAME',
      name: '*',
      value: edgeHost,
      ttl: 300,
      purpose: 'routing',
      group: 'routing',
      status: 'covered_by_parent',
      scope: 'parent',
      covered_by_parent_hostname: inheritedFrom,
      status_reason: `Este subdominio está cubierto por el wildcard de ${inheritedFrom}.`,
      routing_target_type: 'cloudfront_distribution',
    });
  } else if (isCustomRootDomain(domain)) {
    instructions.push(
      {
        record_type: 'ALIAS/ANAME',
        name: '@',
        value: edgeHost,
        ttl: 300,
        purpose: 'routing',
        group: 'routing',
        status: routingStatus,
        scope: 'root',
        status_reason: routingStatusReason(
          routingStatus,
          routingTargetType,
          legacyEdgeHost,
        ),
        routing_target_type: routingTargetType,
      },
      {
        record_type: 'CNAME',
        name: '*',
        value: edgeHost,
        ttl: 300,
        purpose: 'routing',
        group: 'routing',
        status: routingStatus,
        scope: 'wildcard',
        status_reason: routingStatusReason(
          routingStatus,
          routingTargetType,
          legacyEdgeHost,
        ),
        routing_target_type: routingTargetType,
      },
    );
  } else {
    instructions.push({
      record_type: isSubdomain ? 'CNAME' : 'ALIAS/ANAME',
      name: isSubdomain ? domain.hostname.split('.')[0] : '@',
      value: edgeHost,
      ttl: 300,
      purpose: 'routing',
      group: 'routing',
      status: routingStatus,
      scope: isSubdomain ? 'subdomain' : 'root',
      status_reason: routingStatusReason(
        routingStatus,
        routingTargetType,
        legacyEdgeHost,
      ),
      routing_target_type: routingTargetType,
    });
  }

  const enrichedInstructions = instructions.map((record) =>
    withProviderFields(record, domain.hostname),
  );
  const stages = buildProvisioningStages({
    domain,
    ownershipStatus,
    certificateStatus,
    routingStatus,
    inheritedFrom,
    sslConfig,
  });

  return {
    hostname: domain.hostname,
    ownership: domain.ownership,
    dns_type: 'CNAME',
    target: edgeHost,
    requires_alias: !isSubdomain && !inheritedFrom,
    ownership_status: ownershipStatus,
    certificate_status: certificateStatus,
    routing_status: routingStatus,
    wildcard_hostname: getWildcardHostname(domain) ?? undefined,
    covered_by_parent_hostname: inheritedFrom,
    provisioning_stage: currentProvisioningStage(stages),
    stages,
    aws_certificate_status:
      stringValue(sslConfig['aws_certificate_status']) ??
      stringValue(sslConfig['certificate_status']) ??
      (domain.ssl_status === 'issued' ? 'ISSUED' : undefined),
    cloudfront_status: stringValue(sslConfig['cloudfront_status']),
    https_probe_status: probeStatusValue(sslConfig['https_probe_status']),
    next_check_at: stringValue(sslConfig['next_check_at']),
    instructions: enrichedInstructions,
  };
}

export async function enrichDomainDnsInstructionsWithDiagnostics(
  payload: DomainDnsInstructionsPayload,
  dnsResolver: DnsResolverService,
  params?: {
    legacyEdgeHost?: string;
  },
): Promise<DomainDnsInstructionsPayload> {
  const legacyEdgeHost = params?.legacyEdgeHost;
  const targetARecords = await safeResolveA(dnsResolver, payload.target);
  const legacyARecords =
    legacyEdgeHost && legacyEdgeHost !== payload.target
      ? await safeResolveA(dnsResolver, legacyEdgeHost)
      : null;

  const instructions = await Promise.all(
    payload.instructions.map(async (record) => {
      if (record.status === 'covered_by_parent') return record;

      if (record.group === 'ownership') {
        return enrichExpectedValueRecord(
          record,
          await dnsResolver.resolveTxt(record.fqdn_name ?? record.name),
          record.value,
          'Vendix ve el TXT desde DNS público.',
          'Vendix aún no ve el TXT desde DNS público.',
        );
      }

      if (record.group === 'certificate') {
        const awsIssued =
          payload.aws_certificate_status === 'ISSUED' ||
          payload.certificate_status === 'complete';
        const enriched = enrichExpectedValueRecord(
          record,
          await dnsResolver.resolveCname(record.fqdn_name ?? record.name),
          record.value,
          'El certificado ya fue verificado. Conserva el CNAME para renovaciones.',
          'Aún no se ve este CNAME de validación desde DNS público.',
        );

        return awsIssued
          ? {
              ...enriched,
              status: 'complete' as const,
              status_reason:
                enriched.detected_values && enriched.detected_values.length > 0
                  ? 'El certificado ya fue verificado. Conserva el CNAME para renovaciones.'
                  : 'El certificado ya fue verificado; si el CNAME falta, vuelve a agregarlo para futuras renovaciones.',
            }
          : enriched;
      }

      if (record.group === 'routing') {
        return enrichRoutingRecord(
          record,
          dnsResolver,
          payload.target,
          targetARecords,
          legacyEdgeHost,
          legacyARecords,
        );
      }

      return record;
    }),
  );

  return {
    ...payload,
    instructions,
  };
}

function withProviderFields(
  record: DomainDnsInstruction,
  hostname: string,
): DomainDnsInstruction {
  const providerHost = toProviderHost(record.name, hostname);
  return {
    ...record,
    provider_host: providerHost,
    fqdn_name: toFqdnName(record.name, providerHost, hostname),
  };
}

function toProviderHost(name: string, hostname: string): string {
  const normalized = trimDot(name);
  if (normalized === hostname) return '@';
  if (normalized === `*.${hostname}`) return '*';
  if (normalized === '@' || normalized === '*') return normalized;

  const suffix = `.${hostname}`;
  if (normalized.endsWith(suffix)) {
    const relative = normalized.slice(0, -suffix.length);
    return relative || '@';
  }

  if (!normalized.includes('.')) return normalized;

  return normalized;
}

function toFqdnName(
  originalName: string,
  providerHost: string,
  hostname: string,
): string {
  const normalized = trimDot(originalName);
  if (normalized.includes('.') && normalized !== hostname) return normalized;
  if (providerHost === '@') return hostname;
  if (providerHost === '*') return `*.${hostname}`;
  return `${providerHost}.${hostname}`;
}

function trimDot(value: string): string {
  return value.endsWith('.') ? value.slice(0, -1) : value;
}

function normalizeDnsValue(value: string): string {
  return trimDot(value).toLowerCase();
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function probeStatusValue(
  value: unknown,
): 'pending' | 'passed' | 'failed' | undefined {
  return value === 'pending' || value === 'passed' || value === 'failed'
    ? value
    : undefined;
}

function routingStatusReason(
  status: DomainInstructionStatus,
  routingTargetType: 'cloudfront_distribution' | 'legacy_edge_alias',
  legacyEdgeHost?: string,
): string {
  if (status === 'complete') return 'El enrutamiento ya fue aplicado.';
  if (routingTargetType === 'legacy_edge_alias') {
    return 'Este destino anterior sigue siendo aceptado, pero para nuevos registros recomendamos el destino directo.';
  }
  return legacyEdgeHost
    ? `Apunta hacia el destino directo. Si ya usas ${legacyEdgeHost}, Vendix lo acepta como destino anterior.`
    : 'Apunta hacia el destino directo de conexión.';
}

function buildProvisioningStages(params: {
  domain: DomainHostingRecord;
  ownershipStatus: DomainInstructionStatus;
  certificateStatus: DomainInstructionStatus;
  routingStatus: DomainInstructionStatus;
  inheritedFrom: string | null;
  sslConfig: Record<string, unknown>;
}): DomainProvisioningStage[] {
  const {
    domain,
    ownershipStatus,
    certificateStatus,
    routingStatus,
    inheritedFrom,
    sslConfig,
  } = params;
  const cloudfrontStatus = stringValue(sslConfig['cloudfront_status']);
  const httpsProbeStatus = probeStatusValue(sslConfig['https_probe_status']);
  const active = domain.status === 'active';
  const failed = domain.status.startsWith('failed');

  return [
    {
      key: 'ownership',
      label: 'Verificación Vendix',
      status:
        failed && ownershipStatus !== 'complete' ? 'failed' : ownershipStatus,
      detail:
        ownershipStatus === 'complete'
          ? 'La propiedad del dominio ya fue verificada.'
          : inheritedFrom
            ? `Cubierto por ${inheritedFrom}.`
            : 'Agrega el TXT de propiedad.',
      waiting: ownershipStatus === 'pending',
      updated_at: toIso(domain.last_verified_at),
    },
    {
      key: 'certificate',
      label: 'Certificado SSL',
      status:
        failed && certificateStatus !== 'complete'
          ? 'failed'
          : certificateStatus === 'complete'
            ? 'complete'
            : 'waiting',
      detail:
        certificateStatus === 'complete'
          ? 'El certificado ya fue verificado.'
          : 'Esperando validación DNS del certificado.',
      waiting: certificateStatus === 'pending',
      updated_at: toIso(domain.certificate_issued_at),
    },
    {
      key: 'routing',
      label: 'Enrutamiento DNS',
      status:
        routingStatus === 'complete'
          ? 'complete'
          : routingStatus === 'covered_by_parent'
            ? 'covered_by_parent'
            : 'waiting',
      detail:
        routingStatus === 'complete'
          ? 'El dominio ya apunta al destino correcto.'
          : 'Esperando que los DNS apunten al destino correcto.',
      waiting: routingStatus === 'pending',
    },
    {
      key: 'cloudfront',
      label: 'Conexión del dominio',
      status:
        active || cloudfrontStatus === 'Deployed'
          ? 'complete'
          : domain.status === 'pending_alias' || domain.status === 'propagating'
            ? 'waiting'
            : 'pending',
      detail:
        active || cloudfrontStatus === 'Deployed'
          ? 'La conexión del dominio ya fue desplegada.'
          : 'Vendix está conectando el dominio.',
      waiting:
        domain.status === 'pending_alias' || domain.status === 'propagating',
      updated_at: toIso(domain.cloudfront_deployed_at),
    },
    {
      key: 'https',
      label: 'Prueba HTTPS',
      status:
        active || httpsProbeStatus === 'passed'
          ? 'complete'
          : httpsProbeStatus === 'failed'
            ? 'waiting'
            : 'pending',
      detail:
        active || httpsProbeStatus === 'passed'
          ? 'Vendix confirmó que HTTPS responde desde internet.'
          : 'Probando que el certificado funcione desde internet.',
      waiting:
        httpsProbeStatus === 'pending' ||
        httpsProbeStatus === 'failed' ||
        domain.status === 'propagating',
      updated_at: stringValue(sslConfig['last_probe_at']),
    },
    {
      key: 'active',
      label: 'Activo',
      status: active ? 'complete' : 'pending',
      detail: active
        ? 'El dominio ya está listo para clientes.'
        : 'Aún no pruebes el dominio como definitivo.',
      waiting: false,
    },
  ];
}

function currentProvisioningStage(
  stages: DomainProvisioningStage[],
): DomainProvisioningStageKey {
  return stages.find((stage) => stage.status !== 'complete')?.key ?? 'active';
}

function toIso(value?: Date | string | null): string | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : value;
}

function enrichExpectedValueRecord(
  record: DomainDnsInstruction,
  result: ResolverResult<string>,
  expectedValue: string,
  successReason: string,
  pendingReason: string,
): DomainDnsInstruction {
  const expected = normalizeDnsValue(expectedValue);
  const seenIn = result.perResolver
    .filter((resolver) =>
      resolver.records.some((value) => normalizeDnsValue(value) === expected),
    )
    .map((resolver) => resolver.resolver);
  const found = seenIn.length >= 2;

  return {
    ...record,
    detected_values: uniqueValues(result.perResolver.flatMap((r) => r.records)),
    seen_in: seenIn,
    status: found ? 'complete' : 'pending',
    status_reason: found ? successReason : pendingReason,
  };
}

async function enrichRoutingRecord(
  record: DomainDnsInstruction,
  dnsResolver: DnsResolverService,
  target: string,
  targetARecords: ResolverResult<string> | null,
  legacyEdgeHost?: string,
  legacyARecords?: ResolverResult<string> | null,
): Promise<DomainDnsInstruction> {
  const fqdn = record.fqdn_name ?? record.name;
  const cnameResult = await dnsResolver.resolveCname(fqdn);
  const aResult = await dnsResolver.resolveA(fqdn);
  const expectedTargets = [target, legacyEdgeHost]
    .filter(Boolean)
    .map((value) => normalizeDnsValue(value as string));
  const cnameMatches = cnameResult.perResolver.filter((resolver) =>
    resolver.records.some((value) =>
      expectedTargets.includes(normalizeDnsValue(value)),
    ),
  );
  const targetIps = new Set([
    ...(targetARecords?.records ?? []),
    ...(legacyARecords?.records ?? []),
  ]);
  const aMatches = aResult.perResolver.filter((resolver) =>
    resolver.records.some((value) => targetIps.has(value)),
  );
  const found = cnameMatches.length >= 2 || aMatches.length >= 2;
  const usedLegacy =
    legacyEdgeHost &&
    cnameResult.perResolver.some((resolver) =>
      resolver.records.some(
        (value) =>
          normalizeDnsValue(value) === normalizeDnsValue(legacyEdgeHost),
      ),
    );

  return {
    ...record,
    detected_values: uniqueValues([
      ...cnameResult.perResolver.flatMap((r) => r.records),
      ...aResult.perResolver.flatMap((r) => r.records),
    ]),
    seen_in: uniqueValues([
      ...cnameMatches.map((resolver) => resolver.resolver),
      ...aMatches.map((resolver) => resolver.resolver),
    ]),
    status: found ? 'complete' : 'pending',
    status_reason: found
      ? usedLegacy
        ? `Detectado usando ${legacyEdgeHost} como destino anterior. Funciona, pero recomendamos el destino directo para nuevos registros.`
        : 'Vendix ve este enrutamiento desde DNS público.'
      : 'Vendix aún no ve este enrutamiento desde DNS público.',
    routing_target_type: usedLegacy
      ? 'legacy_edge_alias'
      : record.routing_target_type,
  };
}

async function safeResolveA(
  dnsResolver: DnsResolverService,
  hostname: string,
): Promise<ResolverResult<string> | null> {
  try {
    return await dnsResolver.resolveA(hostname);
  } catch {
    return null;
  }
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}
