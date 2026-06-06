import { apiGet, apiPost, apiPut, ListParams } from '@/core/api/http';
import { Endpoints } from '@/core/api/endpoints';
import type { OrgUser, InviteUserInput, UpdateUserInput, UserStats } from '@/core/models/org-admin/users.types';

export const OrgUsersService = {
  list: async (params?: ListParams) =>
    apiGet<OrgUser[]>(Endpoints.ORGANIZATION.USERS.LIST, params),
  get: async (id: string) =>
    apiGet<OrgUser>(Endpoints.ORGANIZATION.USERS.GET.replace(':id', id)),
  create: async (body: InviteUserInput) =>
    apiPost<OrgUser>(Endpoints.ORGANIZATION.USERS.CREATE, body),
  update: async (id: string, body: UpdateUserInput) =>
    apiPut<OrgUser>(Endpoints.ORGANIZATION.USERS.UPDATE.replace(':id', id), body),
  toggleState: async (id: string, state: 'ACTIVE' | 'SUSPENDED' | 'DISABLED') =>
    apiPut(Endpoints.ORGANIZATION.USERS.TOGGLE_STATE.replace(':id', id), { state }),
  resetPassword: async (id: string) =>
    apiPost(Endpoints.ORGANIZATION.USERS.RESET_PASSWORD.replace(':id', id)),
  invite: async (body: InviteUserInput) =>
    apiPost<OrgUser>(Endpoints.ORGANIZATION.USERS.INVITE, body),
  verifyEmail: async (id: string) =>
    apiPost(Endpoints.ORGANIZATION.USERS.VERIFY_EMAIL.replace(':id', id)),
  getStats: async () =>
    apiGet<UserStats>(Endpoints.ORGANIZATION.USERS.STATS),
  assignRoleToUser: async (body: { user_id: string; role_id: string }) =>
    apiPost(Endpoints.ORGANIZATION.USERS.ASSIGN_TO_USER, body),
  removeRoleFromUser: async (body: { user_id: string; role_id: string }) =>
    apiPost(Endpoints.ORGANIZATION.USERS.REMOVE_FROM_USER, body),
};
