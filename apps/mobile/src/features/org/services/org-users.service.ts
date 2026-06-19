import { apiGet, apiPost, apiPut, apiPatch, apiDelete, apiGetRaw, ListParams } from '@/core/api/http';
import { Endpoints } from '@/core/api/endpoints';
import type { OrgUser, InviteUserInput, UpdateUserInput, UserStats } from '@/core/models/org-admin/users.types';

export const OrgUsersService = {
  list: async (params?: ListParams) =>
    apiGet<OrgUser[]>(Endpoints.ORGANIZATION.USERS.LIST, params),
  listPaginated: async (params?: ListParams) =>
    apiGetRaw<any>(Endpoints.ORGANIZATION.USERS.LIST, params),
  get: async (id: string) =>
    apiGet<OrgUser>(Endpoints.ORGANIZATION.USERS.GET.replace(':id', id)),
  create: async (body: InviteUserInput) =>
    apiPost<OrgUser>(Endpoints.ORGANIZATION.USERS.CREATE, body),
  update: async (id: string, body: UpdateUserInput) =>
    apiPatch<OrgUser>(Endpoints.ORGANIZATION.USERS.UPDATE.replace(':id', id), body),
  toggleState: async (id: string, state: 'ACTIVE' | 'SUSPENDED' | 'DISABLED') =>
    apiPut(Endpoints.ORGANIZATION.USERS.TOGGLE_STATE.replace(':id', id), { state }),
  resetPassword: async (id: string, body: any) =>
    apiPost(Endpoints.ORGANIZATION.USERS.RESET_PASSWORD.replace(':id', id), body),
  invite: async (body: any) =>
    apiPost<any>(Endpoints.ORGANIZATION.USERS.INVITE, body),
  verifyEmail: async (id: string) =>
    apiPost(Endpoints.ORGANIZATION.USERS.VERIFY_EMAIL.replace(':id', id)),
  getStats: async () =>
    apiGet<UserStats>(Endpoints.ORGANIZATION.USERS.STATS),
  assignRoleToUser: async (body: { user_id: string; role_id: string }) =>
    apiPost(Endpoints.ORGANIZATION.USERS.ASSIGN_TO_USER, body),
  removeRoleFromUser: async (body: { user_id: string; role_id: string }) =>
    apiPost(Endpoints.ORGANIZATION.USERS.REMOVE_FROM_USER, body),
  getConfiguration: async (id: string) =>
    apiGet<any>(Endpoints.ORGANIZATION.USERS.CONFIGURATION.replace(':id', id)),
  updateConfiguration: async (id: string, body: any) =>
    apiPatch<any>(Endpoints.ORGANIZATION.USERS.CONFIGURATION.replace(':id', id), body),
  archive: async (id: string) =>
    apiPost<any>(Endpoints.ORGANIZATION.USERS.ARCHIVE.replace(':id', id), {}),
  reactivate: async (id: string) =>
    apiPost<any>(Endpoints.ORGANIZATION.USERS.REACTIVATE.replace(':id', id), {}),
  delete: async (id: string) =>
    apiDelete<any>(Endpoints.ORGANIZATION.USERS.DELETE.replace(':id', id)),
};
