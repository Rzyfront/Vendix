import { apiGet, apiPost, apiPut, apiDelete, ListParams } from '@/core/api/http';
import { Endpoints } from '@/core/api/endpoints';
import type {
  Domain,
  DomainRoot,
  DnsRecord,
  DomainStats,
  VerifyDomainResult,
  DnsInstructions,
  CreateDomainInput,
  UpdateDomainInput,
} from '@/core/models/org-admin/domains.types';

/**
 * Servicio de Dominios para ORG_ADMIN.
 *
 * Rutas del backend:
 *   GET   /:id                          → buscar por id
 *   GET   /hostname/:hostname           → buscar por hostname
 *   PUT   /hostname/:hostname           → actualizar (hostname es la PK lógica)
 *   DELETE /hostname/:hostname          → eliminar
 *   POST  /hostname/:hostname/verify    → verificación DNS
 *   POST  /:id/ssl-renew                → renovar SSL
 *
 * La asimetría id vs hostname es del backend: las mutaciones se rutean por
 * hostname para no acoplar el cliente a un id numérico interno.
 */
export const OrgDomainsService = {
  list: async (params?: ListParams) =>
    apiGet<Domain[]>(Endpoints.ORGANIZATION.DOMAINS.LIST, params),
  stats: async () =>
    apiGet<DomainStats>(Endpoints.ORGANIZATION.DOMAINS.STATS),
  get: async (id: string) =>
    apiGet<Domain>(Endpoints.ORGANIZATION.DOMAINS.GET.replace(':id', id)),
  getByHostname: async (hostname: string) =>
    apiGet<Domain>(Endpoints.ORGANIZATION.DOMAINS.BY_HOSTNAME.replace(':hostname', hostname)),
  getByStore: async (storeId: string) =>
    apiGet<Domain[]>(Endpoints.ORGANIZATION.DOMAINS.BY_STORE.replace(':storeId', storeId)),
  create: async (body: CreateDomainInput) =>
    apiPost<Domain>(Endpoints.ORGANIZATION.DOMAINS.CREATE, body),
  update: async (hostname: string, body: UpdateDomainInput) =>
    apiPut<Domain>(
      Endpoints.ORGANIZATION.DOMAINS.UPDATE.replace(':hostname', hostname),
      body,
    ),
  remove: async (hostname: string) =>
    apiDelete(Endpoints.ORGANIZATION.DOMAINS.DELETE.replace(':hostname', hostname)),
  verify: async (hostname: string) =>
    apiPost<VerifyDomainResult>(
      Endpoints.ORGANIZATION.DOMAINS.VERIFY.replace(':hostname', hostname),
      {},
    ),
  getDnsInstructions: async (hostname: string) =>
    apiGet<DnsInstructions>(
      Endpoints.ORGANIZATION.DOMAINS.DNS_INSTRUCTIONS.replace(':hostname', hostname),
    ),
  renewSsl: async (id: string) =>
    apiPost<{ renewed: boolean; ssl_status: string; message?: string }>(
      Endpoints.ORGANIZATION.DOMAINS.SSL_RENEW.replace(':id', id),
      {},
    ),
  listRoots: async () =>
    apiGet<DomainRoot[]>(Endpoints.ORGANIZATION.DOMAINS.ROOTS),
  getRootDnsInstructions: async (rootId: string) =>
    apiGet<DnsRecord[]>(Endpoints.ORGANIZATION.DOMAINS.ROOTS_DNS.replace(':rootId', rootId)),
  provisionNext: async (rootId: string, body?: { subdomain?: string }) =>
    apiPost(Endpoints.ORGANIZATION.DOMAINS.PROVISION_NEXT.replace(':rootId', rootId), body),
  verifyRoot: async (rootId: string) =>
    apiPost(Endpoints.ORGANIZATION.DOMAINS.VERIFY_ROOT.replace(':rootId', rootId), {}),
  checkDuplicate: async (hostname: string) =>
    apiPost<{ duplicate: boolean }>(
      Endpoints.ORGANIZATION.DOMAINS.CHECK_DUPLICATE.replace(':hostname', hostname),
      {},
    ),
  validateHostname: async (hostname: string) =>
    apiPost<{ valid: boolean; hostname?: string; reason?: string }>(
      Endpoints.ORGANIZATION.DOMAINS.VALIDATE_HOSTNAME,
      { hostname },
    ),
};