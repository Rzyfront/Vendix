import { Prisma } from '@prisma/client';

export type DomainInstructionStatus =
  | 'pending'
  | 'complete'
  | 'not_required'
  | 'covered_by_parent';

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
}

export interface DomainDnsInstructionsPayload {
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
  return wildcardHostname ? [domain.hostname, wildcardHostname] : [domain.hostname];
}

export function getCloudFrontAliasesForDomain(
  domain: DomainHostingRecord,
): string[] {
  return getCertificateDomainNames(domain);
}

export function getInheritedFromHostname(
  domain: DomainHostingRecord,
): string | null {
  const inherited = getDomainSslConfig(domain.config)['inherited_from_hostname'];
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
}): DomainDnsInstructionsPayload {
  const { domain, edgeHost, verificationToken } = params;
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
    });
  }

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
    instructions,
  };
}
