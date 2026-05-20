import { apiClient, Endpoints } from '@/core/api';

export interface AppNotification {
  id: number;
  title: string;
  body: string;
  type: string;
  is_read: boolean;
  data: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface NotificationsResponse {
  data: AppNotification[];
  meta: {
    total: number;
    page: number;
    limit: number;
    unread_count: number;
  };
}

export const NotificationsService = {
  async getNotifications(page: number = 1, limit: number = 20): Promise<NotificationsResponse> {
    const response = await apiClient.get<NotificationsResponse>(Endpoints.NOTIFICATIONS, {
      params: { page, limit },
    });
    return response.data;
  },

  async getUnreadCount(): Promise<number> {
    const response = await apiClient.get<{ data: { count: number } }>(`${Endpoints.NOTIFICATIONS}/unread-count`);
    return response.data?.data?.count || 0;
  },

  async markRead(id: number): Promise<void> {
    await apiClient.patch(`${Endpoints.NOTIFICATIONS}/${id}/read`);
  },

  async markAllRead(): Promise<void> {
    await apiClient.patch(`${Endpoints.NOTIFICATIONS}/read-all`);
  },
};
