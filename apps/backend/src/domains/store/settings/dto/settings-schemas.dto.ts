import {
  IsString,
  IsBoolean,
  IsNumber,
  Min,
  Max,
  IsEnum,
  IsArray,
  IsOptional,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class GeneralSettingsDto {
  @ApiProperty({ example: 'America/Bogota' })
  @IsString()
  timezone: string;

  @ApiProperty({ example: 'USD' })
  @IsString()
  currency: string;

  @ApiProperty({ example: 'es' })
  @IsString()
  language: string;

  @ApiProperty({ example: false })
  @IsBoolean()
  tax_included: boolean;
}

export class InventorySettingsDto {
  @ApiProperty({ example: 10 })
  @IsNumber()
  @Min(0)
  low_stock_threshold: number;

  @ApiProperty({
    enum: ['hide', 'show', 'disable', 'allow_backorder'],
    example: 'hide',
  })
  @IsEnum(['hide', 'show', 'disable', 'allow_backorder'])
  out_of_stock_action: 'hide' | 'show' | 'disable' | 'allow_backorder';

  @ApiProperty({ example: true })
  @IsBoolean()
  track_inventory: boolean;

  @ApiProperty({ example: false })
  @IsBoolean()
  allow_negative_stock: boolean;

  @ApiProperty({ example: false })
  @IsBoolean()
  require_serial_numbers: boolean;

  @ApiProperty({ example: false })
  @IsBoolean()
  require_batch_tracking: boolean;

  @ApiProperty({ example: true })
  @IsBoolean()
  auto_adjust_stock: boolean;
}

export class CheckoutSettingsDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  require_customer_data: boolean;

  @ApiProperty({ example: true })
  @IsBoolean()
  require_email: boolean;

  @ApiProperty({ example: false })
  @IsBoolean()
  require_phone: boolean;

  @ApiProperty({ example: false })
  @IsBoolean()
  allow_guest_checkout: boolean;

  @ApiProperty({ example: false })
  @IsBoolean()
  allow_partial_payments: boolean;

  @ApiProperty({ example: 0 })
  @IsNumber()
  @Min(0)
  payment_terms_days: number;

  @ApiProperty({ example: true })
  @IsBoolean()
  require_payment_confirmation: boolean;
}

export class ShippingSettingsDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  enabled: boolean;

  @ApiProperty({ example: 0 })
  @IsNumber()
  @Min(0)
  free_shipping_threshold: number;

  @ApiProperty({ example: ['Bogotá', 'Medellín'], type: [String] })
  @IsArray()
  @IsString({ each: true })
  shipping_zones: string[];

  @ApiProperty({ example: true })
  @IsBoolean()
  allow_pickup: boolean;

  @ApiProperty({ example: null, required: false })
  @IsOptional()
  @IsString()
  default_shipping_method?: string | null;
}

export class NotificationsSettingsDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  email_enabled: boolean;

  @ApiProperty({ example: false })
  @IsBoolean()
  sms_enabled: boolean;

  @ApiProperty({ example: true })
  @IsBoolean()
  low_stock_alerts: boolean;

  @ApiProperty({ example: true })
  @IsBoolean()
  new_order_alerts: boolean;

  @ApiProperty({ example: 'alerts@store.com', required: false })
  @IsOptional()
  @IsString()
  low_stock_alerts_email?: string | null;

  @ApiProperty({ example: 'orders@store.com', required: false })
  @IsOptional()
  @IsString()
  new_order_alerts_email?: string | null;

  @ApiProperty({ example: '+573001234567', required: false })
  @IsOptional()
  @IsString()
  low_stock_alerts_phone?: string | null;

  @ApiProperty({ example: '+573001234567', required: false })
  @IsOptional()
  @IsString()
  new_order_alerts_phone?: string | null;
}

export class PosSettingsDto {
  @ApiProperty({
    example: {
      monday: { open: '09:00', close: '19:00' },
      tuesday: { open: '09:00', close: '19:00' },
    },
    type: Object,
  })
  business_hours: Record<string, { open: string; close: string }>;

  @ApiProperty({ example: false })
  @IsBoolean()
  offline_mode_enabled: boolean;

  @ApiProperty({ example: false })
  @IsBoolean()
  require_cash_drawer_open: boolean;

  @ApiProperty({ example: true })
  @IsBoolean()
  auto_print_receipt: boolean;

  @ApiProperty({ example: true })
  @IsBoolean()
  allow_price_edit: boolean;

  @ApiProperty({ example: true })
  @IsBoolean()
  allow_discount: boolean;

  @ApiProperty({ example: 15 })
  @IsNumber()
  @Min(0)
  @Max(100)
  max_discount_percentage: number;

  @ApiProperty({ example: false })
  @IsBoolean()
  allow_refund_without_approval: boolean;
}

export class ReceiptsSettingsDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  print_receipt: boolean;

  @ApiProperty({ example: false })
  @IsBoolean()
  email_receipt: boolean;

  @ApiProperty({ example: '', required: false })
  @IsOptional()
  @IsString()
  receipt_header?: string;

  @ApiProperty({ example: '¡Gracias por su compra!' })
  @IsString()
  receipt_footer: string;
}
