import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export type VendorSupportFiscalEnvironment = 'test' | 'production';

/**
 * Payload to enable/disable the platform vendor-support fiscal pipeline.
 * Mirrors UpsertSubscriptionFiscalConfigDto but for document_type=support_document.
 *
 * If `is_enabled=true` and no support_document `dian_configurations` row exists
 * for the platform org, the service clones the sales_invoice configuration so
 * the platform reuses the same certificate + software credentials.
 */
export class PatchVendorSupportFiscalConfigDto {
  @IsBoolean()
  is_enabled!: boolean;

  @IsBoolean()
  auto_transmit!: boolean;

  @IsIn(['test', 'production'])
  environment!: VendorSupportFiscalEnvironment;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  invoice_resolution_id?: number;
}

export class VendorSupportFiscalQueryDto {
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number = 1;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  limit?: number = 20;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsIn(['test', 'production'])
  environment?: VendorSupportFiscalEnvironment;

  @IsOptional()
  @IsString()
  search?: string;
}

export class RetryVendorSupportFiscalDto {
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
