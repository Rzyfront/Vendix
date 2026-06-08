import { apiGet, apiPut, apiPost } from '@/core/api/http';
import { Endpoints } from '@/core/api/endpoints';
import type { UserProfile, UserSettingsForm } from '@/core/models/org-admin/profile.types';

export const OrgProfileService = {
  getMe: async () => apiGet<UserProfile>(Endpoints.AUTH.ME),
  updateProfile: async (body: Partial<UserProfile>) => apiPut<UserProfile>(Endpoints.AUTH.PROFILE, body),
  getSettings: async () => apiGet<UserSettingsForm>(Endpoints.AUTH.SETTINGS),
  updateSettings: async (body: Partial<UserSettingsForm>) => apiPut<UserSettingsForm>(Endpoints.AUTH.SETTINGS, body),
  switchEnvironment: async (body: { app_type: 'STORE_ADMIN' | 'ORG_ADMIN' | 'SUPER_ADMIN'; store_slug?: string }) =>
    apiPost<{ access_token: string; refresh_token: string; user: UserProfile }>(
      Endpoints.AUTH.SWITCH_ENVIRONMENT,
      body
    ),
};
