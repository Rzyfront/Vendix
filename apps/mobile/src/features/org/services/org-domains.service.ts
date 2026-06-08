import { apiGet, apiPost, apiPut, apiDelete, ListParams } from '@/core/api/http';
import { Endpoints } from '@/core/api/endpoints';
import type { Domain, DomainRoot, DnsRecord } from '@/core/models/org-admin/domains.types';

export const OrgDomainsService = {
  list: async (params?: ListParams) =>
    apiGet<Domain[]>(Endpoints.ORGANIZATION.DOMAINS.LIST, params),
  get: async (id: string) =>
    apiGet<Domain>(Endpoints.ORGANIZATION.DOMAINS.GET.replace(':id', id)),
  create: async (body: { hostname: string; root_domain: string; subdomain?: string; is_primary?: boolean }) =>
    apiPost<Domain>(Endpoints.ORGANIZATION.DOMAINS.CREATE, body),
  update: async (id: string, body: Partial<Domain>) =>
    apiPut<Domain>(Endpoints.ORGANIZATION.DOMAINS.UPDATE.replace(':id', id), body),
  remove: async (id: string) =>
    apiDelete(Endpoints.ORGANIZATION.DOMAINS.DELETE.replace(':id', id)),
  verify: async (id: string) =>
    apiPost<{ status: string; records: DnsRecord[] }>(Endpoints.ORGANIZATION.DOMAINS.VERIFY.replace(':id', id)),
  getDnsInstructions: async (hostname: string) =>
    apiGet<DnsRecord[]>(Endpoints.ORGANIZATION.DOMAINS.DNS_INSTRUCTIONS.replace(':hostname', hostname)),
  listRoots: async () =>
    apiGet<DomainRoot[]>(Endpoints.ORGANIZATION.DOMAINS.ROOTS),
  getRootDnsInstructions: async (rootId: string) =>
    apiGet<DnsRecord[]>(Endpoints.ORGANIZATION.DOMAINS.ROOTS_DNS.replace(':rootId', rootId)),
  provisionNext: async (rootId: string, body?: { subdomain?: string }) =>
    apiPost(Endpoints.ORGANIZATION.DOMAINS.PROVISION_NEXT.replace(':rootId', rootId), body),
  verifyRoot: async (rootId: string) =>
    apiPost(Endpoints.ORGANIZATION.DOMAINS.VERIFY_ROOT.replace(':rootId', rootId)),
  checkDuplicate: async (hostname: string) =>
    apiPost<{ duplicate: boolean }>(Endpoints.ORGANIZATION.DOMAINS.CHECK_DUPLICATE.replace(':hostname', hostname)),
  validateHostname: async (hostname: string) =>
    apiPost<{ valid: boolean; reason?: string }>(Endpoints.ORGANIZATION.DOMAINS.VALIDATE_HOSTNAME, { hostname }),
};
