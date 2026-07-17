import {
  IsString,
  IsBoolean,
  IsNumber,
  IsInt,
  Min,
  Max,
  IsEnum,
  IsArray,
  IsOptional,
  ValidateNested,
  IsUrl,
  IsUUID,
  Matches,
  IsIn,
  IsNotEmpty,
  MaxLength,
  ValidateIf,
  ArrayMinSize,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { StoreIndustry } from '../../stores/dto/index';
import {} from './shipping-carriers.dto';

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

  @ApiProperty({
    enum: StoreIndustry,
    isArray: true,
    example: [StoreIndustry.RETAIL, StoreIndustry.RESTAURANT],
    required: false,
    description:
      'Multi-select industry classification. Mirrored to stores.industries; empty arrays are rejected.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(StoreIndustry, { each: true })
  industries?: StoreIndustry[];
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

  @ApiProperty({ enum: ['cpp', 'fifo'], example: 'cpp', required: false })
  @IsOptional()
  @IsIn(['cpp', 'fifo'])
  costing_method?: 'cpp' | 'fifo';

  @ApiProperty({
    enum: ['main_location', 'all_locations'],
    example: 'main_location',
    required: false,
    description:
      'Scope used by POS when locating stock for sale. `main_location` restricts POS to the store default location; `all_locations` allows any active location.',
  })
  @IsOptional()
  @IsEnum(['main_location', 'all_locations'])
  pos_stock_scope?: 'main_location' | 'all_locations';

  @ApiProperty({
    enum: ['main_location', 'all_locations'],
    example: 'main_location',
    required: false,
    description:
      'Scope used by low-stock alerts. `main_location` evaluates only the default location; `all_locations` aggregates across all active locations.',
  })
  @IsOptional()
  @IsEnum(['main_location', 'all_locations'])
  low_stock_alerts_scope?: 'main_location' | 'all_locations';
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
  @Matches(/^[\d+#*\s()-]*$/, {
    message:
      'El teléfono solo puede contener números y los símbolos + # * ( ) -',
  })
  low_stock_alerts_phone?: string;

  @ApiProperty({ example: '+573001234567', required: false })
  @IsOptional()
  @IsString()
  @Matches(/^[\d+#*\s()-]*$/, {
    message:
      'El teléfono solo puede contener números y los símbolos + # * ( ) -',
  })
  new_order_alerts_phone?: string;

  @ApiProperty({
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  sound_id?: string | null;

  @ApiProperty({ example: 70, required: false, minimum: 0, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  sound_volume?: number;

  @ApiProperty({ example: false, required: false })
  @IsOptional()
  @IsBoolean()
  sound_muted?: boolean;
}

export class ScaleDeviceConfigDto {
  @ApiProperty({ example: 9600, required: false })
  @IsOptional()
  @IsNumber()
  @IsIn([9600, 19200, 38400, 115200])
  baud_rate?: number;

  @ApiProperty({ example: 8, required: false, enum: [7, 8] })
  @IsOptional()
  @IsNumber()
  @IsIn([7, 8])
  data_bits?: 7 | 8;

  @ApiProperty({ example: 1, required: false, enum: [1, 2] })
  @IsOptional()
  @IsNumber()
  @IsIn([1, 2])
  stop_bits?: 1 | 2;

  @ApiProperty({
    example: 'none',
    required: false,
    enum: ['none', 'even', 'odd'],
  })
  @IsOptional()
  @IsIn(['none', 'even', 'odd'])
  parity?: 'none' | 'even' | 'odd';

  @ApiProperty({
    example: 'generic',
    required: false,
    enum: ['generic', 'cas', 'ohaus'],
  })
  @IsOptional()
  @IsIn(['generic', 'cas', 'ohaus'])
  protocol?: 'generic' | 'cas' | 'ohaus';
}

export class ScaleSettingsDto {
  @ApiProperty({ example: false, required: false })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiProperty({ example: true, required: false })
  @IsOptional()
  @IsBoolean()
  allow_manual_weight_entry?: boolean;

  @ApiProperty({ example: 'kg', required: false, enum: ['kg', 'g', 'lb'] })
  @IsOptional()
  @IsIn(['kg', 'g', 'lb'])
  default_weight_unit?: 'kg' | 'g' | 'lb';

  @ApiProperty({ type: ScaleDeviceConfigDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => ScaleDeviceConfigDto)
  device?: ScaleDeviceConfigDto;
}

export class CashRegisterSettingsDto {
  @ApiProperty({ example: false, required: false })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiProperty({ example: false, required: false })
  @IsOptional()
  @IsBoolean()
  require_session_for_sales?: boolean;

  @ApiProperty({ example: false, required: false })
  @IsOptional()
  @IsBoolean()
  allow_multiple_sessions_per_user?: boolean;

  @ApiProperty({ example: true, required: false })
  @IsOptional()
  @IsBoolean()
  auto_create_default_register?: boolean;

  @ApiProperty({ example: true, required: false })
  @IsOptional()
  @IsBoolean()
  require_closing_count?: boolean;

  @ApiProperty({ example: true, required: false })
  @IsOptional()
  @IsBoolean()
  track_non_cash_payments?: boolean;
}

export class BarcodeScannerSettingsDto {
  @ApiProperty({ example: false, required: false })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class CustomerQueueSettingsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsNumber()
  queue_expiry_hours?: number;

  @IsOptional()
  @IsNumber()
  max_queue_size?: number;

  @IsOptional()
  @IsBoolean()
  require_email?: boolean;
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

  @ApiProperty({ enum: ['continuous', 'custom'], example: 'continuous', required: false })
  @IsOptional()
  @IsIn(['continuous', 'custom'])
  schedule_mode?: 'continuous' | 'custom';

  @ApiProperty({ example: false, required: false })
  @IsOptional()
  @IsBoolean()
  offline_mode_enabled?: boolean;

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

  @ApiProperty({ type: ScaleSettingsDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => ScaleSettingsDto)
  scale?: ScaleSettingsDto;

  @ApiProperty({ type: () => CashRegisterSettingsDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => CashRegisterSettingsDto)
  cash_register?: CashRegisterSettingsDto;

  @ApiProperty({ type: () => BarcodeScannerSettingsDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => BarcodeScannerSettingsDto)
  barcode_scanner?: BarcodeScannerSettingsDto;

  @ApiProperty({
    example: true,
    required: false,
    description: 'Show on-screen numeric keypad in POS cash payment',
  })
  @IsOptional()
  @IsBoolean()
  show_onscreen_keypad?: boolean;

  @ApiProperty({
    enum: ['contado', 'credito'],
    example: 'contado',
    required: false,
  })
  @IsOptional()
  @IsIn(['contado', 'credito'])
  default_payment_form?: 'contado' | 'credito';

  @ApiProperty({ type: () => CustomerQueueSettingsDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => CustomerQueueSettingsDto)
  customer_queue?: CustomerQueueSettingsDto;
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
  @ApiProperty({
    example: 'Vendix',
    description: 'Nombre de la aplicación',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiProperty({
    example: '#7ED7A5',
    description: 'Color primario en formato HEX',
    required: false,
  })
  @IsOptional()
  @IsString()
  @Matches(/^#[0-9A-Fa-f]{6}$/, {
    message: 'primary_color must be a valid hex color (e.g., #7ED7A5)',
  })
  primary_color?: string;

  @ApiProperty({
    example: '#2F6F4E',
    description: 'Color secundario en formato HEX',
    required: false,
  })
  @IsOptional()
  @IsString()
  @Matches(/^#[0-9A-Fa-f]{6}$/, {
    message: 'secondary_color must be a valid hex color',
  })
  secondary_color?: string;

  @ApiProperty({
    example: '#FFFFFF',
    description: 'Color de acento en formato HEX',
    required: false,
  })
  @IsOptional()
  @IsString()
  @Matches(/^#[0-9A-Fa-f]{6}$/, {
    message: 'accent_color must be a valid hex color',
  })
  accent_color?: string;

  @ApiProperty({
    enum: ['default', 'aura', 'monocromo'],
    example: 'default',
    required: false,
  })
  @IsOptional()
  @ValidateIf((o) => o.theme !== undefined && o.theme !== null)
  @IsIn(['default', 'aura', 'monocromo'], {
    message: 'theme must be either "default", "aura", or "monocromo"',
  })
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

export class OperationsSettingsDto {
  @ApiProperty({ example: 15, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  default_preparation_time_minutes?: number;

  @ApiProperty({ example: 3, required: false, description: 'Hora (0-23) de cierre/reseteo diario del KDS' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(23)
  ticket_closing_hour?: number;
}

export class AvailabilitySettingsDto {
  /**
   * Days of the week (0=Sunday … 6=Saturday) on which the store wants
   * generic slot generation to produce slots. Mirrors
   * `AvailabilitySettings.working_days` in the store-settings interface.
   */
  @ApiProperty({
    type: [Number],
    example: [1, 2, 3, 4, 5],
    required: true,
    description:
      'Days of the week (0=Sun, 1=Mon, …, 6=Sat) the store is open. ' +
      'Used by AvailabilityService.generateGenericSlots as a fallback when ' +
      'no provider_schedules row covers the date. Default: Mon-Fri.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  working_days: number[];
}

export class DispatchSettingsDto {
  @ApiProperty({
    enum: ['live', 'on_close'],
    example: 'on_close',
    required: false,
    description:
      'When a COD order linked to a dispatch route reflects "delivered": `live` updates it on each stop settle; `on_close` only on route close (default).',
  })
  @IsOptional()
  @IsIn(['live', 'on_close'])
  order_state_update_mode?: 'live' | 'on_close';

  // Plan Despacho Economía — FASE 2 paso 9. Defaults globales de despacho.
  @ApiProperty({
    enum: ['prepaid', 'on_delivery'],
    required: false,
    description:
      'Fallback global: timing de pago del envío cuando el método no define política.',
  })
  @IsOptional()
  @IsIn(['prepaid', 'on_delivery'])
  default_payment_timing?: 'prepaid' | 'on_delivery';

  @ApiProperty({
    enum: ['none', 'per_delivery', 'per_route'],
    required: false,
    description: 'Fallback global: tipo de liquidación del transportista.',
  })
  @IsOptional()
  @IsIn(['none', 'per_delivery', 'per_route'])
  default_settlement_type?: 'none' | 'per_delivery' | 'per_route';

  @ApiProperty({
    enum: ['immediate_on_close'],
    required: false,
    description: 'Fallback global: cuándo se liquida el costo del transportista.',
  })
  @IsOptional()
  @IsIn(['immediate_on_close'])
  default_cost_settlement_timing?: 'immediate_on_close';

  @ApiProperty({
    required: false,
    description: 'ID de la ubicación origen por defecto para nuevas rutas.',
  })
  @IsOptional()
  @IsInt()
  default_origin_location_id?: number;

  @ApiProperty({
    required: false,
    description: 'Si true, una orden sin dirección de entrega no es despachable.',
  })
  @IsOptional()
  @IsBoolean()
  requires_dispatch_address?: boolean;
}

export class RestaurantSettingsDto {
  @ApiProperty({
    example: false,
    required: false,
    description:
      'Enables paying/closing a table check directly from the table screen (table checkout).',
  })
  @IsOptional()
  @IsBoolean()
  enable_table_checkout?: boolean;

  @ApiProperty({
    enum: ['menu_only', 'mark_occupied', 'open_tab', 'require_staff'],
    example: 'menu_only',
    required: false,
    description:
      'Behavior when a customer scans a table QR code. `menu_only` (default) shows the digital menu without changing table state; `mark_occupied` marks the table occupied; `open_tab` also opens a tab (draft order); `require_staff` requires staff confirmation first.',
  })
  @IsOptional()
  @IsIn(['menu_only', 'mark_occupied', 'open_tab', 'require_staff'])
  qr_scan_behavior?: 'menu_only' | 'mark_occupied' | 'open_tab' | 'require_staff';

  @ApiProperty({
    example: false,
    required: false,
    description:
      'When true, scanning the QR auto-fires order items to KDS/kitchen (same as the POS "fire" action). Default false — items stay as a draft until staff fires them.',
  })
  @IsOptional()
  @IsBoolean()
  qr_auto_fire?: boolean;
}

export class FingerprintDeviceConfigDto {
  @ApiProperty({
    example: 'id_wrapper',
    required: false,
    enum: ['id_wrapper', 'template_sdk'],
    description:
      "Reader integration mode. `id_wrapper` (default, Tipo A): reader emits an opaque ID. `template_sdk` (Tipo B, plan only): reader ships a template to a configured SDK provider.",
  })
  @IsOptional()
  @IsIn(['id_wrapper', 'template_sdk'])
  reader_type?: 'id_wrapper' | 'template_sdk';

  @ApiProperty({
    example: 'zkteco',
    required: false,
    enum: ['zkteco', 'digitalpersona', 'generic_http'],
    description: 'SDK provider for `template_sdk` mode.',
  })
  @IsOptional()
  @IsIn(['zkteco', 'digitalpersona', 'generic_http'])
  sdk_provider?: 'zkteco' | 'digitalpersona' | 'generic_http';

  @ApiProperty({
    example: 'https://fingerprint-adapter.example.com/identify',
    required: false,
    description:
      'URL of the SDK adapter for `template_sdk` mode. Not used in `id_wrapper` mode.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  endpoint?: string;

  @ApiProperty({
    example: 'fp-sdk-prod',
    required: false,
    description:
      'Reference (NOT the key) to the API key used to authenticate against the SDK endpoint.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  api_key_ref?: string;

  @ApiProperty({
    example: 5000,
    required: false,
    description: 'Request timeout in milliseconds when calling the SDK.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  timeout_ms?: number;

  @ApiProperty({
    example: 2000,
    required: false,
    description: 'Per-verification timeout in milliseconds (latency cap).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  verify_timeout_ms?: number;
}

export class MembershipSettingsDto {
  @ApiProperty({
    example: false,
    required: false,
    description:
      'Enables ambient (background) access validation for gym memberships.',
  })
  @IsOptional()
  @IsBoolean()
  ambient_access_enabled?: boolean;

  @ApiProperty({
    example: false,
    required: false,
    description:
      'Kiosk mode: keeps the QR scanner always-on (continuous loop) on the Aforo tab for an unattended reception tablet.',
  })
  @IsOptional()
  @IsBoolean()
  qr_kiosk_mode?: boolean;

  @ApiProperty({
    example: 'fullscreen',
    required: false,
    enum: ['fullscreen', 'floating'],
    description:
      'Default display mode for the Aforo QR scanner: fullscreen overlay or a movable floating window (bubble).',
  })
  @IsOptional()
  @IsIn(['fullscreen', 'floating'])
  qr_scanner_default_mode?: 'fullscreen' | 'floating';

  @ApiProperty({
    example: false,
    required: false,
    description: 'Enables capacity (aforo) control for the membership area.',
  })
  @IsOptional()
  @IsBoolean()
  capacity_control_enabled?: boolean;

  @ApiProperty({
    example: 0,
    required: false,
    description: 'Maximum number of people allowed inside (aforo máximo).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  max_capacity?: number;

  @ApiProperty({
    example: false,
    required: false,
    description:
      'When true, a turnstile controls entries/exits and automatic leveling is disabled.',
  })
  @IsOptional()
  @IsBoolean()
  turnstile_mode?: boolean;

  @ApiProperty({
    example: false,
    required: false,
    description:
      'Enables automatic capacity leveling (time-based decrement of the occupancy count).',
  })
  @IsOptional()
  @IsBoolean()
  auto_leveling_enabled?: boolean;

  @ApiProperty({
    example: 2,
    required: false,
    description:
      'Interval in hours after which automatic leveling decrements the occupancy count by 1 person.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn([1, 2])
  auto_leveling_interval_hours?: number;

  @ApiProperty({
    type: FingerprintDeviceConfigDto,
    required: false,
    description:
      'Fingerprint reader device configuration. Default reader_type is `id_wrapper` (current behavior: reader emits an opaque ID, Vendix never sees the template).',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => FingerprintDeviceConfigDto)
  fingerprint_device?: FingerprintDeviceConfigDto;
}

export class PanelUISettingsDto {
  @IsOptional()
  STORE_ADMIN?: Record<string, boolean>;

  @IsOptional()
  STORE_ECOMMERCE?: Record<string, boolean>;
}

export class AccountingFlowsSettingsDto {
  @IsOptional()
  @IsBoolean()
  invoicing?: boolean;

  @IsOptional()
  @IsBoolean()
  payments?: boolean;

  @IsOptional()
  @IsBoolean()
  expenses?: boolean;

  @IsOptional()
  @IsBoolean()
  payroll?: boolean;

  @IsOptional()
  @IsBoolean()
  credit_sales?: boolean;

  @IsOptional()
  @IsBoolean()
  inventory?: boolean;

  @IsOptional()
  @IsBoolean()
  returns?: boolean;

  @IsOptional()
  @IsBoolean()
  purchases?: boolean;

  @IsOptional()
  @IsBoolean()
  layaway?: boolean;

  @IsOptional()
  @IsBoolean()
  fixed_assets?: boolean;

  @IsOptional()
  @IsBoolean()
  withholding?: boolean;

  @IsOptional()
  @IsBoolean()
  settlements?: boolean;

  @IsOptional()
  @IsBoolean()
  wallet?: boolean;

  @IsOptional()
  @IsBoolean()
  cash_register?: boolean;

  @IsOptional()
  @IsBoolean()
  stock_transfers?: boolean;

  @IsOptional()
  @IsBoolean()
  commissions?: boolean;

  @IsOptional()
  @IsBoolean()
  ar_ap?: boolean;

  @IsOptional()
  @IsBoolean()
  installments?: boolean;
}

export class AccountingModuleFlowsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  invoicing?: boolean;

  @IsOptional()
  @IsBoolean()
  payments?: boolean;

  @IsOptional()
  @IsBoolean()
  expenses?: boolean;

  @IsOptional()
  @IsBoolean()
  payroll?: boolean;

  @IsOptional()
  @IsBoolean()
  credit_sales?: boolean;

  @IsOptional()
  @IsBoolean()
  inventory?: boolean;

  @IsOptional()
  @IsBoolean()
  returns?: boolean;

  @IsOptional()
  @IsBoolean()
  purchases?: boolean;

  @IsOptional()
  @IsBoolean()
  layaway?: boolean;

  @IsOptional()
  @IsBoolean()
  fixed_assets?: boolean;

  @IsOptional()
  @IsBoolean()
  withholding?: boolean;

  @IsOptional()
  @IsBoolean()
  settlements?: boolean;

  @IsOptional()
  @IsBoolean()
  wallet?: boolean;

  @IsOptional()
  @IsBoolean()
  cash_register?: boolean;

  @IsOptional()
  @IsBoolean()
  stock_transfers?: boolean;

  @IsOptional()
  @IsBoolean()
  commissions?: boolean;

  @IsOptional()
  @IsBoolean()
  ar_ap?: boolean;

  @IsOptional()
  @IsBoolean()
  installments?: boolean;
}

export class PayrollModuleFlowsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class InvoicingModuleFlowsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class ModuleFlowsSettingsDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => AccountingModuleFlowsDto)
  accounting?: AccountingModuleFlowsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PayrollModuleFlowsDto)
  payroll?: PayrollModuleFlowsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => InvoicingModuleFlowsDto)
  invoicing?: InvoicingModuleFlowsDto;
}
