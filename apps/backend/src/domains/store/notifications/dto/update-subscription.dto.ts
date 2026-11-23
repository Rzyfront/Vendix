import { IsString, IsBoolean, IsOptional, IsIn } from 'class-validator';
import { CONFIGURABLE_NOTIFICATION_TYPES } from '../notification-catalog';

/**
 * Preferencia de un tipo de aviso para el usuario en la tienda actual.
 * `type` se valida contra el catálogo (`NOTIFICATION_CATALOG`), no contra una
 * lista fija: agregar un tipo configurable es agregarlo allí.
 * `in_app` = Dispositivo (web push); `email` = Correo.
 */
export class UpdateSubscriptionDto {
  @IsString()
  @IsIn(CONFIGURABLE_NOTIFICATION_TYPES)
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
