import type { ISODateString } from './common.types';

/**
 * Tipos para la sección "Dominios" de ORG_ADMIN.
 *
 * El backend (apps/backend/src/domains/organization/domains) expone:
 *   GET    /organization/domains                       → list paginated
 *   GET    /organization/domains/stats                 → DomainStats
 *   GET    /organization/domains/:id                   → Domain
 *   GET    /organization/domains/hostname/:hostname    → Domain
 *   GET    /organization/domains/store/:storeId        → Domain[]
 *   POST   /organization/domains                       → create
 *   PUT    /organization/domains/hostname/:hostname    → update
 *   DELETE /organization/domains/hostname/:hostname    → remove
 *   POST   /organization/domains/hostname/:hostname/verify → VerifyDomainResult
 *   GET    /organization/domains/dns-instructions/:hostname → DnsInstructions
 *   POST   /organization/domains/:id/ssl-renew         → renew SSL
 *   POST   /organization/domains/validate-hostname     → { valid, reason? }
 *   POST   /organization/domains/hostname/:hostname/duplicate → { duplicate }
 *
 * El frontend web espeja este contrato en
 * apps/frontend/src/app/private/modules/organization/domains/interfaces/domain.interface.ts
 * y los formatters en
 * apps/frontend/src/app/private/modules/organization/domains/domains.component.ts
 * (formatAppType / formatOwnership / formatStatus / formatSslStatus).
 */

export type DomainStatus =
  | 'PENDING'
  | 'VERIFYING'
  | 'PENDING_DNS'
  | 'PENDING_OWNERSHIP'
  | 'VERIFYING_OWNERSHIP'
  | 'PENDING_SSL'
  | 'PENDING_CERTIFICATE'
  | 'ISSUING_CERTIFICATE'
  | 'PENDING_ALIAS'
  | 'PROPAGATING'
  | 'FAILED'
  | 'FAILED_OWNERSHIP'
  | 'FAILED_CERTIFICATE'
  | 'FAILED_ALIAS'
  | 'EXPIRED'
  | 'ACTIVE'
  | 'DISABLED';

export type DomainOwnership =
  | 'VENDIX_SUBDOMAIN'
  | 'CUSTOM_DOMAIN'
  | 'CUSTOM_SUBDOMAIN'
  | 'THIRD_PARTY_SUBDOMAIN';

export type AppType =
  | 'STORE_ECOMMERCE'
  | 'STORE_LANDING'
  | 'STORE_ADMIN'
  | 'ORG_LANDING'
  | 'ORG_ADMIN';

export type SslStatus =
  | 'PENDING'
  | 'PROVISIONING'
  | 'ISSUED'
  | 'ACTIVE'
  | 'NONE'
  | 'ERROR'
  | 'REVOKED'
  | 'FAILED'
  | 'EXPIRED';

export type CloudfrontStatus =
  | 'PENDING'
  | 'PROVISIONING'
  | 'ACTIVE'
  | 'FAILED';

export interface DnsRecord {
  type: 'A' | 'AAAA' | 'CNAME' | 'TXT' | 'MX' | 'NS' | 'SRV';
  host: string;
  value: string;
  ttl?: number;
  priority?: number;
  status?: 'PENDING' | 'VERIFIED' | 'FAILED';
}

/** Subset del store que el join devuelve cuando un dominio está vinculado a uno. */
export interface DomainStoreRef {
  id: string;
  name: string;
  slug?: string;
}

export interface Domain {
  id: string;
  hostname: string;
  root_domain: string;
  subdomain?: string | null;
  status: DomainStatus;
  is_primary: boolean;
  is_verified: boolean;
  ssl_status?: SslStatus;
  cloudfront_status?: CloudfrontStatus;
  certificate_id?: string;
  organization_id: string;
  /** Puede ser un dominio de Organización (store_id = null) o vinculado a una tienda. */
  store_id?: string | null;
  /** Join que el backend agrega en la respuesta del listado. */
  store?: DomainStoreRef | null;
  ownership: DomainOwnership;
  app_type: AppType;
  config?: Record<string, unknown>;
  verification_records?: DnsRecord[];
  dns_instructions?: DnsRecord[];
  last_verified_at?: ISODateString | null;
  created_at: ISODateString;
  updated_at: ISODateString;
  verified_at?: ISODateString | null;
  expires_at?: ISODateString | null;
}

export interface DomainRoot {
  id: string;
  root_domain: string;
  status: DomainStatus;
  certificate_id?: string;
  cloudfront_domain?: string;
  verified_at?: ISODateString | null;
  subdomains: Domain[];
  dns_instructions: DnsRecord[];
  created_at: ISODateString;
  updated_at: ISODateString;
}

export interface DomainStats {
  total: number;
  active: number;
  pending: number;
  verified: number;
}

export interface VerifyDomainResult {
  verified: boolean;
  checks: Array<{
    type: 'cname' | 'a' | 'txt';
    expected?: string;
    actual?: string;
    pass: boolean;
  }>;
  message?: string;
}

export interface DnsInstructions {
  hostname: string;
  /** Edge host (CNAME target) al que el dominio debe apuntar. */
  target: string;
  records: DnsRecord[];
}

export interface DomainQuery {
  search?: string;
  status?: DomainStatus | '';
  ownership?: DomainOwnership | '';
  /** `'__organization__'` = dominios sin tienda asociada; cualquier otro ID = tienda específica. */
  store_id?: string;
  page?: number;
  pageSize?: number;
}

export interface CreateDomainInput {
  hostname: string;
  root_domain: string;
  subdomain?: string;
  store_id?: string | null;
  app_type: AppType;
  ownership: DomainOwnership;
  is_primary?: boolean;
  config?: Record<string, unknown>;
}

export interface UpdateDomainInput {
  store_id?: string | null;
  app_type?: AppType;
  ownership?: DomainOwnership;
  is_primary?: boolean;
  config?: Record<string, unknown>;
}

/**
 * Estados que indican que el dominio está en medio de un flujo async
 * (certificado SSL, alias a CloudFront, propagación). Cuando hay al menos
 * un dominio en uno de estos estados, la pantalla auto-refresca cada 15s
 * para mostrar el progreso al usuario.
 */
export const PENDING_PROVISIONING_STATUSES: ReadonlySet<DomainStatus> = new Set([
  'PENDING_CERTIFICATE',
  'ISSUING_CERTIFICATE',
  'PENDING_ALIAS',
  'PROPAGATING',
]);