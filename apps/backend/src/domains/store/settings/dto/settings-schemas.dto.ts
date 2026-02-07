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
  ValidateIf,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {

} from './shipping-carriers.dto';

export class GeneralSettingsDto {
  // Campos de store_settings (existentes)
  @ApiProperty({ example: 'America/Bogota', required: false })
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiProperty({ example: 'USD', required: false })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiProperty({ example: 'es', required: false })
  @IsOptional()
  @IsString()
  language?: string;

  @ApiProperty({ example: false, required: false })
  @IsOptional()
  @IsBoolean()
  tax_included?: boolean;

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
  @ApiProperty({ example: 10, required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  low_stock_threshold?: number;

  @ApiProperty({
    enum: ['hide', 'show', 'disable', 'allow_backorder'],
    example: 'hide',
    required: false,
  })
  @IsOptional()
  @IsEnum(['hide', 'show', 'disable', 'allow_backorder'])
  out_of_stock_action?: 'hide' | 'show' | 'disable' | 'allow_backorder';

  @ApiProperty({ example: true, required: false })
  @IsOptional()
  @IsBoolean()
  track_inventory?: boolean;

  @ApiProperty({ example: false, required: false })
  @IsOptional()
  @IsBoolean()
  allow_negative_stock?: boolean;
}

export class CheckoutSettingsDto {
  @ApiProperty({ example: true, required: false })
  @IsOptional()
  @IsBoolean()
  require_customer_data?: boolean;

  @ApiProperty({ example: false, required: false })
  @IsOptional()
  @IsBoolean()
  allow_guest_checkout?: boolean;

  @ApiProperty({ example: false, required: false })
  @IsOptional()
  @IsBoolean()
  allow_partial_payments?: boolean;

  @ApiProperty({ example: true, required: false })
  @IsOptional()
  @IsBoolean()
  require_payment_confirmation?: boolean;
}



export class NotificationsSettingsDto {
  @ApiProperty({ example: true, required: false })
  @IsOptional()
  @IsBoolean()
  email_enabled?: boolean;

  @ApiProperty({ example: false, required: false })
  @IsOptional()
  @IsBoolean()
  sms_enabled?: boolean;

  @ApiProperty({ example: true, required: false })
  @IsOptional()
  @IsBoolean()
  low_stock_alerts?: boolean;

  @ApiProperty({ example: true, required: false })
  @IsOptional()
  @IsBoolean()
  new_order_alerts?: boolean;

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
  enable_schedule_validation?: boolean;

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
  @ApiProperty({ example: true, required: false })
  @IsOptional()
  @IsBoolean()
  print_receipt?: boolean;

  @ApiProperty({ example: false, required: false })
  @IsOptional()
  @IsBoolean()
  email_receipt?: boolean;

  @ApiProperty({ example: '', required: false })
  @IsOptional()
  @IsString()
  receipt_header?: string;

  @ApiProperty({ example: '¡Gracias por su compra!', required: false })
  @IsOptional()
  @IsString()
  receipt_footer?: string;
}

export class AppSettingsDto {
  @ApiProperty({ example: 'Vendix', description: 'Nombre de la aplicación', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiProperty({ example: '#7ED7A5', description: 'Color primario en formato HEX', required: false })
  @IsOptional()
  @IsString()
  @Matches(/^#[0-9A-Fa-f]{6}$/, { message: 'primary_color must be a valid hex color (e.g., #7ED7A5)' })
  primary_color?: string;

  @ApiProperty({ example: '#2F6F4E', description: 'Color secundario en formato HEX', required: false })
  @IsOptional()
  @IsString()
  @Matches(/^#[0-9A-Fa-f]{6}$/, { message: 'secondary_color must be a valid hex color' })
  secondary_color?: string;

  @ApiProperty({ example: '#FFFFFF', description: 'Color de acento en formato HEX', required: false })
  @IsOptional()
  @IsString()
  @Matches(/^#[0-9A-Fa-f]{6}$/, { message: 'accent_color must be a valid hex color' })
  accent_color?: string;

  @ApiProperty({ enum: ['default', 'aura', 'monocromo'], example: 'default', required: false })
  @IsOptional()
  @ValidateIf((o) => o.theme !== undefined && o.theme !== null)
  @IsIn(['default', 'aura', 'monocromo'], { message: 'theme must be either "default", "aura", or "monocromo"' })
  theme?: 'default' | 'aura' | 'monocromo';

  @ApiProperty({ example: 'https://example.com/logo.png', required: false })
  @IsOptional()
  @IsString()
  logo_url?: string | null;

  @ApiProperty({ example: 'https://example.com/favicon.ico', required: false })
  @IsOptional()
  @IsString()
  favicon_url?: string | null;
}

export class BrandingSettingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  primary_color?: string;

  @IsOptional()
  @IsString()
  secondary_color?: string;

  @IsOptional()
  @IsString()
  accent_color?: string;

  @IsOptional()
  @IsString()
  background_color?: string;

  @IsOptional()
  @IsString()
  surface_color?: string;

  @IsOptional()
  @IsString()
  text_color?: string;

  @IsOptional()
  @IsString()
  text_secondary_color?: string;

  @IsOptional()
  @IsString()
  text_muted_color?: string;

  @IsOptional()
  @IsString()
  logo_url?: string | null;

  @IsOptional()
  @IsString()
  favicon_url?: string | null;

  @IsOptional()
  @IsString()
  custom_css?: string;
}

export class FontsSettingsDto {
  @IsOptional()
  @IsString()
  primary?: string;

  @IsOptional()
  @IsString()
  secondary?: string;

  @IsOptional()
  @IsString()
  headings?: string;
}

export class PublicationSettingsDto {
  @IsOptional()
  @IsBoolean()
  store_published?: boolean;

  @IsOptional()
  @IsBoolean()
  ecommerce_enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  landing_enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  maintenance_mode?: boolean;

  @IsOptional()
  @IsString()
  maintenance_message?: string;

  @IsOptional()
  @IsBoolean()
  allow_public_access?: boolean;
}

export class PanelUISettingsDto {
  @IsOptional()
  STORE_ADMIN?: Record<string, boolean>;

  @IsOptional()
  STORE_ECOMMERCE?: Record<string, boolean>;
}
