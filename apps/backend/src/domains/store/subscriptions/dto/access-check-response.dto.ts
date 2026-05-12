import { store_subscription_state_enum } from '@prisma/client';
import { ResolvedFeatures } from '../types/access.types';

export type SubscriptionBannerLevel = 'none' | 'info' | 'warning' | 'danger';

export interface AccessCheckResponseDto {
  found: boolean;
  state: store_subscription_state_enum;
  planCode: string;
  features: ResolvedFeatures;
  currentPeriodEnd: string | null;
  overlayActive: boolean;
  overlayExpiresAt: string | null;
  bannerLevel: SubscriptionBannerLevel;
}
