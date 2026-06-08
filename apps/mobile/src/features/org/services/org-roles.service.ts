import { apiGet, apiPost, apiPut, apiDelete, ListParams } from '@/core/api/http';
import { Endpoints } from '@/core/api/endpoints';
import type { Role, CreateRoleInput, UpdateRoleInput, RolePermission } from '@/core/models/org-admin/roles.types';

export const OrgRolesService = {
  list: async (params?: ListParams) =>
    apiGet<Role[]>(Endpoints.ORGANIZATION.ROLES.LIST, params),
  get: async (id: string) =>
    apiGet<Role>(Endpoints.ORGANIZATION.ROLES.GET.replace(':id', id)),
  create: async (body: CreateRoleInput) =>
    apiPost<Role>(Endpoints.ORGANIZATION.ROLES.CREATE, body),
  update: async (id: string, body: UpdateRoleInput) =>
    apiPut<Role>(Endpoints.ORGANIZATION.ROLES.UPDATE.replace(':id', id), body),
  remove: async (id: string) =>
    apiDelete(Endpoints.ORGANIZATION.ROLES.DELETE.replace(':id', id)),
  getPermissions: async (roleId: string) =>
    apiGet<RolePermission[]>(Endpoints.ORGANIZATION.ROLES.PERMISSIONS.replace(':id', roleId)),
  getUserPermissions: async (userId: string) =>
    apiGet<{ permissions: string[] }>(Endpoints.ORGANIZATION.ROLES.USER_PERMISSIONS.replace(':userId', userId)),
  getUserRoles: async (userId: string) =>
    apiGet<{ roles: Role[] }>(Endpoints.ORGANIZATION.ROLES.USER_ROLES.replace(':userId', userId)),
};
