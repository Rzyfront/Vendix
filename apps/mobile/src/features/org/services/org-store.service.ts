import { apiGet, apiPost, apiPut, apiDelete, ListParams } from '@/core/api/http';
import { Endpoints } from '@/core/api/endpoints';
import { unwrapList } from '@/core/api/http';
import type { StoreListItem, StoreDetail, CreateStoreInput, UpdateStoreInput } from '@/core/models/org-admin/store.types';
import type { ApiEnvelope } from '@/core/models/org-admin/common.types';

function normalize(input: CreateStoreInput | UpdateStoreInput | any): any {
  const { address, ...rest } = input || {};
  const out: any = { ...rest };
  if (address) {
    out.address_line1 = (address as any).address_line1 ?? (address as any).street;
    out.address_line2 = (address as any).address_line2;
    out.city = (address as any).city;
    out.state_province = (address as any).state_province ?? (address as any).state;
    out.postal_code = (address as any).postal_code;
    out.country_code = (address as any).country_code ?? (address as any).country ?? 'CO';
    out.phone_number = (address as any).phone_number ?? (address as any).phone;
  }
  return out;
}

export const OrgStoreService = {
  list: async (params?: ListParams) => {
    const raw = await apiGet<ApiEnvelope<StoreListItem[]> | StoreListItem[]>(Endpoints.ORGANIZATION.STORES.LIST, params);
    return { data: unwrapList<StoreListItem>(raw as any) };
  },
  get: async (id: string | number) =>
    apiGet<StoreDetail>(Endpoints.ORGANIZATION.STORES.GET.replace(':id', String(id))),
  getById: async (id: string | number) =>
    apiGet<StoreDetail>(Endpoints.ORGANIZATION.STORES.GET.replace(':id', String(id))),
  create: async (input: CreateStoreInput) =>
    apiPost<StoreListItem>(Endpoints.ORGANIZATION.STORES.CREATE, normalize(input)),
  update: async (id: string | number, input: UpdateStoreInput) =>
    apiPut<StoreListItem>(Endpoints.ORGANIZATION.STORES.UPDATE.replace(':id', String(id)), normalize(input)),
  remove: async (id: string | number) =>
    apiDelete(Endpoints.ORGANIZATION.STORES.DELETE.replace(':id', String(id))),
  stats: async () =>
    apiGet<unknown>(Endpoints.ORGANIZATION.STORES.STATS),
  settings: async (id: string | number) =>
    apiGet<unknown>(Endpoints.ORGANIZATION.STORES.SETTINGS.replace(':id', String(id))),
  getSettings: async (id: string | number) =>
    apiGet<unknown>(Endpoints.ORGANIZATION.STORES.SETTINGS.replace(':id', String(id))),
  updateSettings: async (id: string | number, body: unknown) =>
    apiPut(Endpoints.ORGANIZATION.STORES.SETTINGS.replace(':id', String(id)), body),
  resetSettings: async (id: string | number) =>
    apiPost(Endpoints.ORGANIZATION.STORES.SETTINGS_RESET.replace(':id', String(id))),
  dashboard: async (id: string | number) =>
    apiGet<unknown>(Endpoints.ORGANIZATION.STORES.DASHBOARD.replace(':id', String(id))),
  checkCode: async (code: string) =>
    apiGet<{ available: boolean }>(Endpoints.ORGANIZATION.STORES.CHECK_CODE, { code }),
};
