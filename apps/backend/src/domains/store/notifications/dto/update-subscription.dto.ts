import { IsString, IsBoolean, IsOptional, IsIn } from 'class-validator';

const NOTIFICATION_TYPES = [
  'new_order',
  'order_status_change',
  'low_stock',
  'new_customer',
  'payment_received',
] as const;

export class UpdateSubscriptionDto {
  @IsString()
  @IsIn(NOTIFICATION_TYPES)
  type: string;

  @IsOptional()
  @IsBoolean()
  in_app?: boolean;

  @IsOptional()
  @IsBoolean()
  email?: boolean;
}

export class BulkUpdateSubscriptionsDto {
  subscriptions: UpdateSubscriptionDto[];
}
