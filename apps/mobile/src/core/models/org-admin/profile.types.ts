import type { ISODateString } from './common.types';

export interface UserProfile {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  avatar_url?: string;
  organizations?: {
    id: string;
    name: string;
    slug: string;
    logo_url?: string;
  };
  default_store?: {
    id: string;
    name: string;
    slug: string;
  };
  user_settings?: {
    theme?: 'light' | 'dark' | 'auto';
    language?: string;
    timezone?: string;
    notifications_enabled?: boolean;
  };
  created_at?: ISODateString;
  updated_at?: ISODateString;
}

export interface UserSettingsForm {
  theme: 'light' | 'dark' | 'auto';
  language: string;
  timezone: string;
  notifications_enabled: boolean;
  email_notifications: boolean;
  push_notifications: boolean;
  sms_notifications: boolean;
  marketing_emails: boolean;
}
