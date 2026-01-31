import {
  IsString,
  IsBoolean,
  IsNumber,
  Min,
  Max,
  IsEnum,
  IsArray,
  IsOptional,
  ValidateNested,
  IsUrl,
  Matches,
  IsIn,
  IsNotEmpty,
  MaxLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ShippingTypesConfigDto,
  ShippingZoneDto,
} from './shipping-carriers.dto';

export class GeneralSettingsDto {
  // Campos de store_settings (existentes)
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

  // Campos de la tabla stores (NUEVOS)
  @ApiProperty({ example: 'Mi Tienda', required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ example: 'https://example.com/logo.png', required: false })
  @IsOptional()
  @IsString()
  logo_url?: string;

  @ApiProperty({
    enum: ['physical', 'online', 'hybrid', 'popup', 'kiosko'],
    example: 'physical',
    required: false,
  })
  @IsOptional()
  @IsEnum(['physical', 'online', 'hybrid', 'popup', 'kiosko'])
  store_type?: 'physical' | 'online' | 'hybrid' | 'popup' | 'kiosko';
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
}

export class CheckoutSettingsDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  require_customer_data: boolean;

  @ApiProperty({ example: false })
  @IsBoolean()
  allow_guest_checkout: boolean;

  @ApiProperty({ example: false })
  @IsBoolean()
  allow_partial_payments: boolean;

  @ApiProperty({ example: true })
  @IsBoolean()
  require_payment_confirmation: boolean;
}

export class ShippingSettingsDto {
  @ApiProperty({ example: true, required: false })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiProperty({ example: 0, required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  free_shipping_threshold?: number;

  @ApiProperty({ example: true, required: false })
  @IsOptional()
  @IsBoolean()
  allow_pickup?: boolean;

  @ApiProperty({ example: null, required: false })
  @IsOptional()
  @IsString()
  default_shipping_method?: string | null;

  @ApiProperty({ type: ShippingTypesConfigDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => ShippingTypesConfigDto)
  shipping_types?: ShippingTypesConfigDto;

  @ApiProperty({ type: [ShippingZoneDto], required: false })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ShippingZoneDto)
  shipping_zones?: ShippingZoneDto[];
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
  low_stock_alerts_email?: string;

  @ApiProperty({ example: 'orders@store.com', required: false })
  @IsOptional()
  @IsString()
  new_order_alerts_email?: string;

  @ApiProperty({ example: '+573001234567', required: false })
  @IsOptional()
  @IsString()
  low_stock_alerts_phone?: string;

  @ApiProperty({ example: '+573001234567', required: false })
  @IsOptional()
  @IsString()
  new_order_alerts_phone?: string;
}

export class PosSettingsDto {
  @ApiProperty({ example: false, required: false })
  @IsOptional()
  @IsBoolean()
  allow_anonymous_sales?: boolean;

  @ApiProperty({ example: false, required: false })
  @IsOptional()
  @IsBoolean()
  anonymous_sales_as_default?: boolean;

  @ApiProperty({
    example: {
      monday: { open: '09:00', close: '19:00' },
      tuesday: { open: '09:00', close: '19:00' },
    },
    type: Object,
    required: false,
  })
  @IsOptional()
  business_hours?: Record<string, { open: string; close: string }>;

  @ApiProperty({ example: false, required: false })
  @IsOptional()
  @IsBoolean()
  offline_mode_enabled?: boolean;

  @ApiProperty({ example: false, required: false })
  @IsOptional()
  @IsBoolean()
  require_cash_drawer_open?: boolean;

  @ApiProperty({ example: true, required: false })
  @IsOptional()
  @IsBoolean()
  auto_print_receipt?: boolean;

  @ApiProperty({ example: true, required: false })
  @IsOptional()
  @IsBoolean()
  allow_price_edit?: boolean;

  @ApiProperty({ example: true, required: false })
  @IsOptional()
  @IsBoolean()
  allow_discount?: boolean;

  @ApiProperty({ example: 15, required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  max_discount_percentage?: number;

  @ApiProperty({ example: false, required: false })
  @IsOptional()
  @IsBoolean()
  allow_refund_without_approval?: boolean;
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

export class AppSettingsDto {
  @ApiProperty({ example: 'Vendix', description: 'Nombre de la aplicación' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: '#7ED7A5', description: 'Color primario en formato HEX' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^#[0-9A-Fa-f]{6}$/, { message: 'primary_color must be a valid hex color (e.g., #7ED7A5)' })
  primary_color: string;

  @ApiProperty({ example: '#2F6F4E', description: 'Color secundario en formato HEX' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^#[0-9A-Fa-f]{6}$/, { message: 'secondary_color must be a valid hex color' })
  secondary_color: string;

  @ApiProperty({ example: '#FFFFFF', description: 'Color de acento en formato HEX' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^#[0-9A-Fa-f]{6}$/, { message: 'accent_color must be a valid hex color' })
  accent_color: string;

  @ApiProperty({ enum: ['default', 'aura', 'monocromo'], example: 'default' })
  @IsIn(['default', 'aura', 'monocromo'], { message: 'theme must be either "default", "aura", or "monocromo"' })
  theme: 'default' | 'aura' | 'monocromo';

  @ApiProperty({ example: 'https://example.com/logo.png', required: false })
  @IsOptional()
  @IsUrl({}, { message: 'logo_url must be a valid URL' })
  logo_url?: string;

  @ApiProperty({ example: 'https://example.com/favicon.ico', required: false })
  @IsOptional()
  @IsUrl({}, { message: 'favicon_url must be a valid URL' })
  favicon_url?: string;
}
