import type { ISODateString, MoneyAmount } from './common.types';

export type SubscriptionStatus = 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | 'EXPIRED' | 'PENDING';

export interface SubscriptionPlan {
  id: string;
  code: string;
  name: string;
  description?: string;
  price: MoneyAmount;
  billing_period: 'MONTHLY' | 'QUARTERLY' | 'SEMI_ANNUAL' | 'ANNUAL';
  features: string[];
  limits: Record<string, number>;
  is_active: boolean;
  is_popular?: boolean;
}

export interface Subscription {
  id: string;
  plan_id: string;
  plan_name: string;
  plan_code: string;
  organization_id: string;
  status: SubscriptionStatus;
  start_date: ISODateString;
  end_date: ISODateString;
  current_period_start: ISODateString;
  current_period_end: ISODateString;
  next_billing_date?: ISODateString;
  cancel_at_period_end: boolean;
  cancelled_at?: ISODateString;
  trial_ends_at?: ISODateString;
  amount: MoneyAmount;
  payment_method?: string;
  features: string[];
  usage?: Record<string, { used: number; limit: number }>;
  created_at: ISODateString;
  updated_at: ISODateString;
}

export interface SubscriptionUsage {
  organization_id: string;
  period: { start: ISODateString; end: ISODateString };
  metrics: Array<{
    key: string;
    label: string;
    used: number;
    limit: number;
    unit?: string;
  }>;
}
