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

export class AuthService {
  static async login(credentials: LoginCredentials): Promise<AuthResponse> {
    const response = await apiClient.post<AuthResponse>(
      Endpoints.AUTH.LOGIN,
      credentials
    );
    const { user, token, refreshToken } = response.data;
    await setToken(token);
    await setRefreshToken(refreshToken);
    useAuthStore.getState().setUser(user);
    useAuthStore.getState().setToken(token);
    useAuthStore.getState().setRefreshToken(refreshToken);
    return response.data;
  }

  static async register(data: RegisterData): Promise<AuthResponse> {
    const response = await apiClient.post<AuthResponse>(
      Endpoints.AUTH.REGISTER,
      data
    );
    const { user, token, refreshToken } = response.data;
    await setToken(token);
    await setRefreshToken(refreshToken);
    useAuthStore.getState().setUser(user);
    useAuthStore.getState().setToken(token);
    useAuthStore.getState().setRefreshToken(refreshToken);
    return response.data;
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

  static async refreshToken(refreshToken: string): Promise<{ token: string }> {
    const response = await apiClient.post<{ token: string }>(
      Endpoints.AUTH.REFRESH,
      { refreshToken }
    );
    return response.data;
  }

  static async getMe(): Promise<User> {
    const response = await apiClient.get<User>(Endpoints.USER.ME);
    return response.data;
  }
}
