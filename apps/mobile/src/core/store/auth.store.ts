import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { User, UserSettings, AppType } from '../auth/auth.types';

interface AuthState {
  user: User | null;
  user_settings: UserSettings | null;
  store_settings: any | null;
  default_panel_ui: Record<string, Record<string, boolean>> | null;
  token: string | null;
  refreshToken: string | null;
  roles: string[];
  permissions: string[];
  isAuthenticated: boolean;
  isLoading: boolean;

  setAuthData: (data: {
    user: User;
    user_settings: UserSettings;
    store_settings?: any;
    default_panel_ui?: Record<string, Record<string, boolean>> | null;
    access_token: string;
    refresh_token: string;
  }) => void;
  setUser: (user: User | null) => void;
  setToken: (token: string | null) => void;
  setRefreshToken: (refreshToken: string | null) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      user_settings: null,
      store_settings: null,
      default_panel_ui: null,
      token: null,
      refreshToken: null,
      roles: [],
      permissions: [],
      isAuthenticated: false,
      isLoading: true,

      setAuthData: ({
        user,
        user_settings,
        store_settings,
        default_panel_ui,
        access_token,
        refresh_token,
      }) =>
        set({
          user,
          user_settings,
          store_settings: store_settings || null,
          default_panel_ui: default_panel_ui || null,
          token: access_token,
          refreshToken: refresh_token,
          roles: user.roles || [],
          permissions: [],
          isAuthenticated: true,
          isLoading: false,
        }),

      setUser: (user) =>
        set({
          user,
          roles: user?.roles || [],
          isAuthenticated: !!user,
        }),

      setToken: (token) => set({ token }),
      setRefreshToken: (refreshToken) => set({ refreshToken }),

      logout: () =>
        set({
          user: null,
          user_settings: null,
          store_settings: null,
          default_panel_ui: null,
          token: null,
          refreshToken: null,
          roles: [],
          permissions: [],
          isAuthenticated: false,
        }),
    }),
    {
      name: 'vendix_auth_state',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        user: state.user,
        user_settings: state.user_settings,
        store_settings: state.store_settings,
        default_panel_ui: state.default_panel_ui,
        token: state.token,
        refreshToken: state.refreshToken,
        roles: state.roles,
        permissions: state.permissions,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.isAuthenticated = !!state.token && !!state.user;
          state.isLoading = false;
        }
      },
    }
  )
);

export function getAppType(): AppType {
  return useAuthStore.getState().user_settings?.app_type || 'STORE_ADMIN';
}

export function getRoles(): string[] {
  return useAuthStore.getState().roles || [];
}

export function hasRole(role: string): boolean {
  return getRoles().includes(role);
}

export function isSuperAdmin(): boolean {
  return hasRole('super_admin');
}

export function isOrgAdmin(): boolean {
  const roles = getRoles();
  return roles.includes('owner') || roles.includes('admin');
}
