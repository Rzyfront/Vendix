export interface NotificationSoundAdmin {
  id: string;
  name: string;
  s3_key: string;
  mime_type: string;
  file_size_bytes: number;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  /** Signed read URL provided by backend on list/detail responses. */
  url: string;
}

export interface CreateNotificationSoundPayload {
  name: string;
  sort_order?: number;
  file: File;
}

export interface UpdateNotificationSoundPayload {
  name?: string;
  sort_order?: number;
}

export interface NotificationSoundStats {
  total: number;
  active: number;
  inactive: number;
}
