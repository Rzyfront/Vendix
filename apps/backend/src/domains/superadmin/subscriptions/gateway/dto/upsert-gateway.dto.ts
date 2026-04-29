import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';
import { Transform } from 'class-transformer';

export enum PlatformGatewayEnvironmentEnum {
  SANDBOX = 'sandbox',
  PRODUCTION = 'production',
}

/**
 * Body DTO used by both PATCH /superadmin/subscriptions/gateway/:processor
 * and (optionally) POST /superadmin/subscriptions/gateway/:processor/test.
 *
 * Mirror of the per-store Wompi config DTO but with extra production
 * confirmation for the platform-level configuration.
 *
 * NOTE: The 4 secret fields are OPTIONAL on PATCH. When omitted (or sent
 * as ""), the existing stored credential is preserved — this lets the
 * superadmin toggle `environment` / `is_active` without re-typing every
 * secret. The empty-string → undefined transform is required because
 * `@Matches` runs on present values (including ""), and we want "" to
 * mean "do not rotate this secret".
 */
export class UpsertGatewayDto {
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsOptional()
  @IsString()
  @Matches(/^pub_(test|prod)_/, {
    message: 'La llave pública debe iniciar con pub_test_ o pub_prod_',
  })
  public_key?: string;

  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsOptional()
  @IsString()
  @Matches(/^prv_(test|prod)_/, {
    message: 'La llave privada debe iniciar con prv_test_ o prv_prod_',
  })
  private_key?: string;

  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsOptional()
  @IsString()
  events_secret?: string;

  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsOptional()
  @IsString()
  integrity_secret?: string;

  @IsEnum(PlatformGatewayEnvironmentEnum, {
    message: 'El ambiente debe ser sandbox o production',
  })
  environment: PlatformGatewayEnvironmentEnum;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  /**
   * Required when activating production credentials. Acts as a
   * "I understand" double-confirm flag from the superadmin UI.
   */
  @IsOptional()
  @IsBoolean()
  confirm_production?: boolean;
}

/**
 * Optional body for POST /:processor/test. Allows testing un-saved
 * credentials before persisting them. When omitted, stored credentials
 * are used.
 */
export class TestGatewayConnectionDto {
  @IsOptional()
  @IsString()
  public_key?: string;

  @IsOptional()
  @IsString()
  private_key?: string;

  @IsOptional()
  @IsString()
  events_secret?: string;

  @IsOptional()
  @IsString()
  integrity_secret?: string;

  @IsOptional()
  @IsEnum(PlatformGatewayEnvironmentEnum)
  environment?: PlatformGatewayEnvironmentEnum;
}
