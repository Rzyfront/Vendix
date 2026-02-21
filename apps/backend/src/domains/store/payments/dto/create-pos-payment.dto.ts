import {
  IsNumber,
  IsString,
  IsOptional,
  IsBoolean,
  IsArray,
  IsDateString,
  Min,
  MaxLength,
  ValidateNested,
  IsInt,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';

export class PosOrderItemDto {
  @IsInt()
  @Type(() => Number)
  product_id: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  product_variant_id?: number;

  @IsString()
  @MaxLength(255)
  product_name: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  product_sku?: string;

  @IsOptional()
  @IsString()
  variant_sku?: string;

  @IsOptional()
  variant_attributes?: Record<string, any>;

  @IsInt()
  @Min(1)
  @Type(() => Number)
  quantity: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  unit_price: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  total_price: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 5 })
  @Min(0)
  @Type(() => Number)
  tax_rate?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  tax_amount_item?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  cost?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class PosCreditTermsDto {
  @IsOptional()
  @IsDateString()
  due_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  payment_terms?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class CreatePosPaymentDto {
  // Datos del cliente (opcionales para ventas anónimas)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  customer_id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  customer_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  customer_email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Matches(/^[\d+#*\s()-]*$/, { message: 'El teléfono solo puede contener números y los símbolos + # * ( ) -' })
  customer_phone?: string;

  // Datos de la venta
  @IsInt()
  @Min(1)
  @Type(() => Number)
  store_id: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PosOrderItemDto)
  items: PosOrderItemDto[];

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  subtotal: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  tax_amount?: number = 0;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  discount_amount?: number = 0;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  total_amount: number;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string = 'USD';

  // Datos del pago (opcionales para ventas a crédito)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  store_payment_method_id?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  amount_received?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  payment_reference?: string;

  // Control de flujo de pago
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  requires_payment?: boolean = true;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_partial_payment?: boolean = false;

  // Términos de crédito (para ventas a crédito)
  @IsOptional()
  @ValidateNested()
  @Type(() => PosCreditTermsDto)
  credit_terms?: PosCreditTermsDto;

  // Direcciones (opcionales)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  billing_address_id?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  shipping_address_id?: number;

  // Datos de envío (para órdenes con delivery)
  @IsOptional()
  @IsString()
  @MaxLength(50)
  delivery_type?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  shipping_method_id?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  shipping_cost?: number;

  @IsOptional()
  shipping_address_snapshot?: Record<string, any>;

  // Metadatos POS
  @IsOptional()
  @IsString()
  @MaxLength(100)
  register_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  seller_user_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  internal_notes?: string;

  @IsOptional()
  metadata?: Record<string, any>;

  // Opciones de procesamiento
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  update_inventory?: boolean = true;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  send_email_confirmation?: boolean = false;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  print_receipt?: boolean = false;
}

// DTO para actualizar una orden existente con pago
export class UpdateOrderWithPaymentDto {
  @IsInt()
  @Min(1)
  @Type(() => Number)
  order_id: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  store_payment_method_id?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  amount_received?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  payment_reference?: string;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  requires_payment?: boolean = true;

  @IsOptional()
  @ValidateNested()
  @Type(() => PosCreditTermsDto)
  credit_terms?: PosCreditTermsDto;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  internal_notes?: string;
}

// DTO de respuesta para procesamiento POS
export class PosPaymentResponseDto {
  success: boolean;
  message: string;
  order?: {
    id: number;
    order_number: string;
    status: string;
    payment_status: string;
    total_amount: number;
  };
  payment?: {
    id: number;
    amount: number;
    payment_method: string;
    status: string;
    transaction_id?: string;
    change?: number;
  };
  errors?: string[];
  warnings?: string[];
}
