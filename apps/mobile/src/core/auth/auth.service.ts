import { apiClient, Endpoints } from '../api';
import type {
  LoginCredentials,
  RegisterData,
  ForgotPasswordData,
  AuthResponse,
  User,
} from './auth.types';
import { setToken, setRefreshToken, clearToken } from './token.storage';
import { useAuthStore } from '../store/auth.store';

function unwrap<T>(response: { data: T | { success: boolean; data: T; message?: string } }): T {
  const d = response.data as any;
  if (d && typeof d === 'object' && 'success' in d && 'data' in d) return d.data;
  return d as T;
}

export class AuthService {
  static async login(credentials: LoginCredentials): Promise<AuthResponse> {
    const response = await apiClient.post(Endpoints.AUTH.LOGIN, credentials);
    const data = unwrap<AuthResponse>(response);

    await setToken(data.access_token);
    await setRefreshToken(data.refresh_token);
    useAuthStore.getState().setAuthData({
      user: data.user,
      user_settings: data.user_settings,
      store_settings: data.store_settings,
      default_panel_ui: data.default_panel_ui,
      access_token: data.access_token,
      refresh_token: data.refresh_token,
    });

    return data;
  }

  static async register(data: RegisterData): Promise<AuthResponse> {
    const response = await apiClient.post(Endpoints.AUTH.REGISTER, data);
    const result = unwrap<AuthResponse>(response);

    await setToken(result.access_token);
    await setRefreshToken(result.refresh_token);
    useAuthStore.getState().setAuthData({
      user: result.user,
      user_settings: result.user_settings,
      store_settings: result.store_settings,
      default_panel_ui: result.default_panel_ui,
      access_token: result.access_token,
      refresh_token: result.refresh_token,
    });

    return result;
  }

  static async logout(): Promise<void> {
    try {
      await apiClient.post(Endpoints.AUTH.LOGOUT);
    } finally {
      await clearToken();
      useAuthStore.getState().logout();
    }
  }

  static async forgotPassword(data: ForgotPasswordData): Promise<void> {
    await apiClient.post(Endpoints.AUTH.FORGOT_PASSWORD, data);
  }

  static async resetPassword(data: { newPassword: string; token: string }): Promise<void> {
    await apiClient.post(Endpoints.AUTH.RESET_PASSWORD, data);
  }

  static async refreshToken(refreshToken: string): Promise<{ access_token: string }> {
    const response = await apiClient.post(Endpoints.AUTH.REFRESH, { refresh_token: refreshToken });
    return unwrap<{ access_token: string }>(response);
  }

  static async getMe(): Promise<User> {
    const response = await apiClient.get(Endpoints.AUTH.ME);
    return unwrap<User>(response);
  }
}
