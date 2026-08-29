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
import {
  PRINT_FORMATS,
  PrintDocument,
  PrintDocumentConfig,
  PrintFormat,
  PrintingSettings,
} from '../interfaces/store-settings.interface';
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

  // `null` es un valor de negocio, no ausencia: significa "borrá el logo".
  // `@IsOptional()` de class-validator salta la validación tanto para
  // `undefined` como para `null`, así que el borrado no rebota contra
  // `@IsString()` (QUI-289).
  @ApiProperty({ example: 'https://example.com/logo.png', required: false })
  @IsOptional()
  @IsString()
  logo_url?: string | null;

  @ApiProperty({
    enum: ['physical', 'online', 'hybrid', 'popup', 'kiosko'],
    example: 'physical',
    required: false,
  })
  @IsOptional()
  @IsIn(['physical', 'online', 'hybrid', 'popup', 'kiosko'])
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
  @IsIn(['hide', 'show', 'disable', 'allow_backorder'])
  out_of_stock_action?: 'hide' | 'show' | 'disable' | 'allow_backorder';

  /**
   * SIN LECTOR — se acepta y se persiste, pero ningún servicio la consulta.
   * El descuento de inventario ocurre siempre; no hay forma de apagarlo por
   * configuración. Se conserva el campo para no romper a quien ya lo manda,
   * pero guardarlo no cambia nada. Ver `allow_negative_stock` abajo.
   */
  @ApiProperty({
    example: true,
    required: false,
    description:
      'INACTIVA: se persiste pero ningún proceso la lee. El inventario siempre se descuenta.',
  })
  @IsOptional()
  @IsBoolean()
  track_inventory?: boolean;

  /**
   * SIN LECTOR — se acepta y se persiste, pero ningún servicio la consulta.
   *
   * La sobreventa YA está bloqueada, y no por esta bandera sino en duro:
   * `payments.service.ts` fija `allowOversell = false` y lanza
   * `POS_STOCK_INSUFFICIENT_001`; `reserveStock` lanza `INV_STOCK_001` antes de
   * escribir un disponible negativo; el commit de entrega lanza
   * `INV_STOCK_002`. Poner esta bandera en `true` NO habilita vender sin saldo.
   *
   * Detrás de esas guardas queda un recorte a cero (`Math.max(0, …)`) que actúa
   * en caminos que no pasan por ellas (ajustes, producción, integraciones) y
   * oculta el faltante. Tampoco lo gobierna esta bandera. Sitios del recorte:
   * stock-level-manager.service.ts (~223 y ~992), movements.service.ts (~371 y
   * ~382), inventory-integration.service.ts (~228),
   * sellable-stock-allocator.service.ts (~108-130).
   */
  @ApiProperty({
    example: false,
    required: false,
    description:
      'INACTIVA: se persiste pero ningún proceso la lee. La sobreventa se bloquea en duro (POS_STOCK_INSUFFICIENT_001 / INV_STOCK_001); ponerla en true NO habilita vender sin saldo.',
  })
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
  @IsIn(['main_location', 'all_locations'])
  pos_stock_scope?: 'main_location' | 'all_locations';

  @ApiProperty({
    enum: ['main_location', 'all_locations'],
    example: 'main_location',
    required: false,
    description:
      'Scope used by low-stock alerts. `main_location` evaluates only the default location; `all_locations` aggregates across all active locations.',
  })
  @IsOptional()
  @IsIn(['main_location', 'all_locations'])
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

  /**
   * Anticipación del aviso de vencimiento de cuotas de CxP, en días.
   * 0 desactiva el aviso anticipado; la vencida se sigue emitiendo.
   */
  @ApiProperty({ example: 1, required: false, minimum: 0, maximum: 30 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(30)
  ap_due_soon_days?: number;
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

/** Formato, margen y copias de UN documento imprimible. */
export class PrintDocumentConfigDto implements PrintDocumentConfig {
  @ApiProperty({ enum: PRINT_FORMATS, example: 'thermal_80' })
  @IsEnum(PRINT_FORMATS)
  format!: PrintFormat;

  @ApiProperty({
    example: 20,
    required: false,
    description:
      'Margen de página en milímetros. Se ignora en formatos de rollo, cuya página es `<ancho>mm auto` y no tiene margen del que hablar.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(50)
  margin_mm?: number;

  @ApiProperty({
    example: 1,
    required: false,
    description:
      'Copias impresas. 0 desactiva las impresiones automáticas; una impresión explícita siempre saca al menos una copia.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5)
  copies?: number;
}

/**
 * Configuración de impresión por tienda y por documento.
 *
 * Los doce documentos se declaran uno por uno en vez de aceptar un mapa libre
 * porque el `ValidationPipe` global corre con `whitelist: true` y
 * `forbidNonWhitelisted: true`: un mapa sin declarar se recorta o se rechaza, y
 * declararlo campo por campo es lo que hace que cada documento se valide de
 * verdad (formato dentro del enum, margen y copias en rango) en lugar de entrar
 * como JSON opaco.
 */
export class PrintingSettingsDto implements PrintingSettings {
  @ApiProperty({ type: () => PrintDocumentConfigDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => PrintDocumentConfigDto)
  pos_ticket?: PrintDocumentConfigDto;

  @ApiProperty({ type: () => PrintDocumentConfigDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => PrintDocumentConfigDto)
  invoice?: PrintDocumentConfigDto;

  @ApiProperty({ type: () => PrintDocumentConfigDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => PrintDocumentConfigDto)
  dispatch_ticket?: PrintDocumentConfigDto;

  @ApiProperty({ type: () => PrintDocumentConfigDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => PrintDocumentConfigDto)
  dispatch_note?: PrintDocumentConfigDto;

  @ApiProperty({ type: () => PrintDocumentConfigDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => PrintDocumentConfigDto)
  dispatch_route?: PrintDocumentConfigDto;

  @ApiProperty({ type: () => PrintDocumentConfigDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => PrintDocumentConfigDto)
  sales_order?: PrintDocumentConfigDto;

  @ApiProperty({ type: () => PrintDocumentConfigDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => PrintDocumentConfigDto)
  purchase_order?: PrintDocumentConfigDto;

  @ApiProperty({ type: () => PrintDocumentConfigDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => PrintDocumentConfigDto)
  quotation?: PrintDocumentConfigDto;

  @ApiProperty({ type: () => PrintDocumentConfigDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => PrintDocumentConfigDto)
  reservation?: PrintDocumentConfigDto;

  @ApiProperty({ type: () => PrintDocumentConfigDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => PrintDocumentConfigDto)
  layaway?: PrintDocumentConfigDto;

  @ApiProperty({ type: () => PrintDocumentConfigDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => PrintDocumentConfigDto)
  guest_order?: PrintDocumentConfigDto;

  @ApiProperty({ type: () => PrintDocumentConfigDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => PrintDocumentConfigDto)
  withholding_certificate?: PrintDocumentConfigDto;
}

/**
 * Red de seguridad en tiempo de compilación: `PrintingSettings` es un
 * `Partial<Record<...>>`, así que `implements` NO obliga a declarar todos los
 * documentos. Si alguien agrega uno a `PRINT_DOCUMENTS` y olvida declararlo
 * arriba, esta asignación falla nombrando al que falta — en vez de que el
 * documento nuevo se recorte en silencio en cada guardado, que es exactamente el
 * defecto que este DTO vino a cerrar.
 */
type PrintingDtoCoversEveryDocument =
  Exclude<PrintDocument, keyof PrintingSettingsDto> extends never
    ? true
    : [
        'Falta declarar este documento en PrintingSettingsDto:',
        Exclude<PrintDocument, keyof PrintingSettingsDto>,
      ];
const _printingDtoCoversEveryDocument: PrintingDtoCoversEveryDocument = true;
void _printingDtoCoversEveryDocument;

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

  // ── Electronic invoicing ──────────────────────────────────
  // Only meaningful once the store's `invoicing` fiscal area is active: an
  // habilitado merchant issues electronic invoices, not internal sale receipts.
  @ApiProperty({ example: true, required: false })
  @IsOptional()
  @IsBoolean()
  auto_issue_invoice?: boolean;

  @ApiProperty({ example: 1, required: false, description: '0 = no imprimir' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5)
  invoice_copies?: number;

  @ApiProperty({ example: true, required: false })
  @IsOptional()
  @IsBoolean()
  send_invoice_email?: boolean;

  @ApiProperty({ example: false, required: false })
  @IsOptional()
  @IsBoolean()
  print_pos_ticket?: boolean;

  // ── Delivery channel ──────────────────────────────────────
  // The law requires DELIVERING the invoice to the acquirer, physically or
  // electronically — email is not the only lawful channel. The frontend enforces
  // "at least one of send_invoice_email / deliver_printed".
  @ApiProperty({ example: false, required: false })
  @IsOptional()
  @IsBoolean()
  deliver_printed?: boolean;

  // ── Print formats ─────────────────────────────────────────
  @ApiProperty({
    example: 'letter',
    required: false,
    enum: PRINT_FORMATS,
    description: 'Formato de la representación gráfica de la factura',
  })
  @IsOptional()
  @IsEnum(PRINT_FORMATS)
  invoice_format?: PrintFormat;

  @ApiProperty({ example: 'thermal_80', required: false, enum: PRINT_FORMATS })
  @IsOptional()
  @IsEnum(PRINT_FORMATS)
  pos_ticket_format?: PrintFormat;

  @ApiProperty({ example: 1, required: false, description: '0 = no imprimir' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5)
  pos_ticket_copies?: number;

  /**
   * Configuración por documento — la fuente de la verdad de los formatos.
   *
   * Vive bajo `receipts` y no como sección propia porque `KNOWN_SECTIONS`
   * descarta secciones desconocidas respondiendo 200.
   *
   * **Sin este DTO el bloque no persistía.** El `ValidationPipe` global corre con
   * `whitelist: true` (`main.ts`), así que una propiedad no declarada se recorta
   * antes de llegar al servicio: la pantalla guardaba, respondía 200 y sólo
   * surtían efecto los dos documentos que tienen espejo plano legacy
   * (`pos_ticket_format` / `invoice_format`). Los otros diez se descartaban en
   * silencio.
   */
  @ApiProperty({ type: () => PrintingSettingsDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => PrintingSettingsDto)
  printing?: PrintingSettingsDto;

  /**
   * ADR-7: Habilita la impresión del tiquete de despacho (dispatch_ticket).
   * Plano bajo `receipts` raíz para no ser dropeado por `KNOWN_SECTIONS`.
   */
  @ApiProperty({
    example: true,
    required: false,
    description:
      'Habilita la impresión del tiquete de despacho (dispatch_ticket). ' +
      'Si false, los 2 disparadores (POS auto + orden manual) NO imprimen.',
  })
  @IsOptional()
  @IsBoolean()
  print_dispatch_ticket_enabled?: boolean;

  /**
   * ADR-7: Si true y print_dispatch_ticket_enabled=true, el POS encadena auto
   * el tiquete de despacho junto con ticket POS/factura cuando la venta tiene
   * envío y `shipping_method !== 'direct_delivery'`. Default false (opt-in).
   */
  @ApiProperty({
    example: false,
    required: false,
    description:
      'Si true, el POS encadena auto el tiquete de despacho junto con el ' +
      'ticket POS o factura cuando la venta tiene envío y el método de envío ' +
      'no es direct_delivery. Default false (opt-in por admin).',
  })
  @IsOptional()
  @IsBoolean()
  print_dispatch_ticket_auto_with_pos?: boolean;

  /**
   * ADR-7: Si true y print_dispatch_ticket_enabled=true, al confirmar una
   * venta postventa se auto-imprime el tiquete de despacho (dispatch_ticket)
   * junto con el documento de venta. Default false (opt-in por admin).
   */
  @ApiProperty({
    example: false,
    required: false,
    description:
      'Si true, al confirmar una venta postventa se auto-imprime el tiquete ' +
      'de despacho junto con el documento de venta. Default false (opt-in ' +
      'por admin).',
  })
  @IsOptional()
  @IsBoolean()
  print_dispatch_ticket_auto_on_postventa?: boolean;
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

  // Eje "estilo" del sistema de temas de dos ejes (modo × estilo). El modo
  // (light/dark/system) NO vive aquí: es preferencia de usuario, no branding de
  // tienda. 'glass' faltaba en el enum desde que se añadió el cuarto preset:
  // un PATCH de branding con theme='glass' respondía 400.
  @ApiProperty({
    enum: ['default', 'aura', 'glass', 'monocromo'],
    example: 'default',
    required: false,
  })
  @IsOptional()
  @ValidateIf((o) => o.theme !== undefined && o.theme !== null)
  @IsIn(['default', 'aura', 'glass', 'monocromo'], {
    message: 'theme must be one of "default", "aura", "glass", "monocromo"',
  })
  theme?: 'default' | 'aura' | 'glass' | 'monocromo';

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

  @ApiProperty({
    example: 'warn',
    required: false,
    enum: ['off', 'warn', 'block'],
    description:
      'Re-entry detection policy: off (disabled), warn (grant with a warning flag, no re-count), or block (deny with denied_re_entry). Default warn.',
  })
  @IsOptional()
  @IsIn(['off', 'warn', 'block'])
  re_entry_mode?: 'off' | 'warn' | 'block';

  @ApiProperty({
    example: 2,
    required: false,
    description:
      'Window in hours used by re_entry_mode to consider an access a re-entry. Default 2.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  re_entry_window_hours?: number;
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

/**
 * Services sub-form: where the technician performs the work.
 * Mirrors `store_settings.settings.services` on the backend.
 *
 * Captured in Configuración → General → Servicios. The ecommerce
 * booking flow reads `offer_home_service` to decide whether to
 * show the 'A domicilio' option, and `local_address` as the
 * technician's shop address for the 'En el local' option.
 */
export class ServicesAddressDto {
  @IsOptional() @IsString() address_line1?: string;
  @IsOptional() @IsString() address_line2?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() state_province?: string;
  @IsOptional() @IsString() country_code?: string;
  @IsOptional() @IsString() postal_code?: string;
}

export class ServicesSettingsDto {
  /**
   * Whether the technician goes to the customer's address. When
   * false, the ecommerce booking flow only shows the 'En el local'
   * option. Defaults to true.
   */
  @IsOptional() @IsBoolean() offer_home_service?: boolean;

  /** The technician's shop address (the 'En el local' option). */
  @IsOptional() @ValidateNested() @Type(() => ServicesAddressDto)
  local_address?: ServicesAddressDto;
}

/**
 * Reservations sub-form: how the booking/reschedule flows behave.
 * Mirrors `store_settings.settings.reservations` on the backend.
 *
 * Captured in Configuración → General → Reservas. Today only the
 * `allow_direct_reschedule` toggle is exposed — the rest of the
 * `reservations.*` keys (reminders, confirmation, check_in) are
 * consumed by background jobs and are not yet editable from the UI.
 */
export class ReservationsSettingsDto {
  /**
   * When true (default), customers reschedule a booking with a single
   * click and the change is applied immediately. When false, the
   * customer's reschedule becomes a PENDING REQUEST routed through
   * `booking_reschedule_requests` — the booking stays at its current
   * slot until an admin approves or rejects the request.
   *
   * Mirrors `ReservationsSettings.allow_direct_reschedule` in
   * `store-settings.interface.ts`.
   */
  @ApiProperty({
    example: true,
    required: false,
    description:
      'Si true, el cliente puede reprogramar su reserva al instante (1 click). ' +
      'Si false, la reprogramación queda como solicitud pendiente hasta que ' +
      'un admin apruebe o rechace.',
  })
  @IsOptional()
  @IsBoolean()
  allow_direct_reschedule?: boolean;

  /**
   * CP-POS-SVC-PERF-001 — store-level policy that gates whether the
   * POS can persist a `bookings` row on a draft order (Guardar) or
   * whether scheduling only becomes legal after payment (Cobrar).
   *
   *  - true (default): the POS POSTs /api/store/reservations right
   *    after Guardar so the cashier can book a slot before charging.
   *  - false: bookings are only persisted on the Cobrar path; the
   *    draft order survives without a booking until the cashier
   *    charges it. The editor atomic block attaches the booking then.
   */
  @ApiProperty({
    example: true,
    required: false,
    description:
      'Si true, el POS puede agendar un servicio al Guardar la orden. ' +
      'Si false, el agendamiento solo se persiste al Cobrar (pago confirmado).',
  })
  @IsOptional()
  @IsBoolean()
  allow_bookings_without_payment?: boolean;
}

/**
 * Régimen de IVA para contratos AIU (`operation_type = '09'`).
 *
 * Los dos regímenes existen en la ley y no hay uno correcto: cuál aplica lo
 * decide el CONTRATO. Por eso esto es configuración de la tienda y no una
 * constante del código.
 */
export class AiuSettingsDto {
  @ApiProperty({
    enum: ['et_462_1', 'decreto_1372_1992'],
    example: 'et_462_1',
    required: false,
    description:
      'Régimen de base gravable. `et_462_1` (default, E.T. art. 462-1 — aseo, vigilancia, servicios temporales): la base es el AIU COMPLETO, con piso del 10 % del contrato. `decreto_1372_1992` (art. 3 — contratos de construcción de inmueble): la base es ÚNICAMENTE la utilidad. El default es el conservador: declara más IVA, y pagar de más se recupera mientras que declarar de menos es sanción.',
  })
  @IsOptional()
  @IsIn(['et_462_1', 'decreto_1372_1992'])
  regime?: 'et_462_1' | 'decreto_1372_1992';

  @ApiProperty({
    example: 'servicio de aseo y cafetería para las sedes de Bogotá',
    required: false,
    description:
      'Objeto del contrato. Se concatena al literal obligatorio «Contrato de servicios AIU por concepto de: » en el `cbc:Note` de la línea de ADMINISTRACIÓN (Anexo Técnico 1.9, regla CAV03). La regla exige entre 20 y 5000 caracteres CONTANDO el prefijo, así que describe el contrato — un objeto vacío hace rechazar el documento.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4900, {
    message:
      'contract_object no puede superar 4900 caracteres: la regla CAV03 limita el `cbc:Note` completo a 5000 y el prefijo obligatorio ya ocupa parte.',
  })
  contract_object?: string;

  @ApiProperty({
    example: true,
    required: false,
    description:
      'Aplica el piso legal del 10 % del valor del contrato sobre la base gravable (E.T. art. 462-1). Default true. Sólo tiene sentido bajo `et_462_1`. Cuando el AIU declarado queda por debajo del piso la emisión se RECHAZA indicando cuánto falta — no se infla la base en silencio, porque eso cambiaría el importe que el cliente firmó.',
  })
  @IsOptional()
  @IsBoolean()
  enforce_minimum_base?: boolean;

  @ApiProperty({
    example: 10,
    required: false,
    description:
      'Porcentaje del piso legal. Default 10. Configurable sólo por si la ley cambia; no es una palanca comercial.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  minimum_base_percent?: number;
}

/**
 * Parámetros de emisión fiscal que la ley deja al contribuyente.
 *
 * Va declarado acá **y** en `KNOWN_SECTIONS` (`settings.service.ts`). Las dos
 * cosas: el `ValidationPipe` corre con `whitelist: true`, así que sin la
 * propiedad en `UpdateSettingsDto` el `ValidationPipe` la borra; y el
 * sanitizador de `SettingsService` descarta toda clave de primer nivel que no
 * esté en `KNOWN_SECTIONS` **respondiendo 200 igual**. Faltando cualquiera de
 * las dos, el PATCH del usuario se pierde sin que nadie se entere.
 */
/**
 * Comportamiento fiscal del carril del POS.
 *
 * Es el ÚNICO parámetro que distingue las dos superficies sobre el mismo motor:
 * qué se hace al cerrar una venta de mostrador. Las reglas de validación y el
 * documento que se emite son idénticos en ambas.
 */
export class PosInvoicingSettingsDto {
  @ApiProperty({
    example: true,
    required: false,
    description:
      'Emite el documento electrónico automáticamente al cerrar una venta en el POS. Default true: si la tienda está habilitada ante la DIAN, cada venta debe soportarse con un documento, y esperar a que el cajero lo pida a mano es como se acumulan ventas sin soporte. La emisión ocurre SIEMPRE fuera del cobro, así que apagarlo no acelera la caja — sólo obliga a pedir el documento a mano desde el POS.',
  })
  @IsOptional()
  @IsBoolean()
  auto_emit?: boolean;

  @ApiProperty({
    enum: ['queue', 'ignore'],
    example: 'queue',
    required: false,
    description:
      'Qué se hace con una venta de mostrador que quedó sin documento fiscal. `queue` (default): el fallo se anota en la cola de reintentos con su motivo, y desde ahí es visible en el indicador del POS, en el listado de facturas y reintentable. `ignore`: el fallo sólo queda en el log — para la tienda que emite a mano y no quiere borradores a medio capturar en la cola. NINGUNO de los dos bloquea la venta: cuando esta política se lee, el cobro ya está confirmado en base de datos.',
  })
  @IsOptional()
  @IsIn(['queue', 'ignore'])
  on_failure?: 'queue' | 'ignore';
}

export class InvoicingSettingsDto {
  @ApiProperty({ type: AiuSettingsDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => AiuSettingsDto)
  aiu?: AiuSettingsDto;

  @ApiProperty({ type: PosInvoicingSettingsDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => PosInvoicingSettingsDto)
  pos?: PosInvoicingSettingsDto;
}

/**
 * Master switch for the Vexi assistant.
 *
 * Defaults to disabled: Vexi writes into the commerce's own data, so each store
 * turns it on deliberately instead of inheriting it. Only an explicit `true`
 * enables it.
 *
 * The switch is enforced in three places, not one — route guard, sidebar entry, and
 * the Vexi endpoints themselves — because one that only hides the UI is bypassed by
 * calling the API by hand.
 */
export class VexiSettingsDto {
  @ApiProperty({
    example: true,
    required: false,
    description:
      'Habilita el asistente Vexi para toda la tienda. Con false el dock no se monta y los endpoints de Vexi responden módulo deshabilitado.',
  })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiProperty({
    example: 'realtime',
    enum: ['realtime', 'pipeline'],
    required: false,
    description:
      'Motor del modo voz. `realtime` negocia WebRTC speech-to-speech contra el proveedor; `pipeline` transcribe, responde con el agente de texto del chat y dicta la respuesta. Solo el pipeline puede ejecutar escrituras con confirmación, porque es el único que pasa por la tarjeta de aprobación del panel.',
  })
  @IsOptional()
  @IsIn(['realtime', 'pipeline'])
  voice_engine?: 'realtime' | 'pipeline';
}

export class PromotionsSettingsDto {
  @ApiProperty({
    example: 'winner_takes_all',
    enum: ['winner_takes_all', 'stacking_groups'],
    required: false,
    description:
      'Estrategia de evaluacion de promociones. `winner_takes_all` (default): 1 sola promocion por orden. `stacking_groups`: promociones disjuntas por producto/categoria se aplican concurrentemente.',
  })
  @IsOptional()
  @IsIn(['winner_takes_all', 'stacking_groups'])
  evaluation_strategy?: 'winner_takes_all' | 'stacking_groups';

  @ApiProperty({
    example: 50,
    required: false,
    description:
      'Tope maximo porcentual de descuento acumulado permitido sobre la orden (1-90).',
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(90)
  max_combined_discount_percentage?: number;

  @ApiProperty({
    example: true,
    required: false,
    description:
      'Permite que promociones de orden (scope=order) se apliquen sobre el residual tras descuentos por item.',
  })
  @IsOptional()
  @IsBoolean()
  allow_order_promo_stacking?: boolean;

  @ApiProperty({
    example: false,
    required: false,
    description:
      'Excluye lineas con tarifa mayorista de recibir promociones automaticas adicionales.',
  })
  @IsOptional()
  @IsBoolean()
  exclude_tier_priced_lines?: boolean;

  @ApiProperty({
    example: true,
    required: false,
    description:
      'Activa componentes visuales de alta conversion (escalas interactivas, barra de incentivo gamificada) en storefront y POS.',
  })
  @IsOptional()
  @IsBoolean()
  enable_high_conversion_ui?: boolean;
}

