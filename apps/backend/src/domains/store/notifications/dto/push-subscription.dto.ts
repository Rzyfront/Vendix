import { IsString, IsOptional, ValidateNested, IsObject } from 'class-validator';
import { Type } from 'class-transformer';

class PushSubscriptionKeys {
  @IsString()
  p256dh: string;

  @IsString()
  auth: string;
}

class PushSubscriptionData {
  @IsString()
  endpoint: string;

  @ValidateNested()
  @Type(() => PushSubscriptionKeys)
  @IsObject()
  keys: PushSubscriptionKeys;
}

export class PushSubscriptionDto {
  @ValidateNested()
  @Type(() => PushSubscriptionData)
  @IsObject()
  subscription: PushSubscriptionData;

  @IsOptional()
  @IsString()
  user_agent?: string;
}

export class PushUnsubscribeDto {
  @IsString()
  endpoint: string;
}
