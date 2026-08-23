import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
} from 'class-validator';

export class AddAttachmentDto {
  @IsOptional()
  @IsString()
  supplier_invoice_number?: string;

  @IsOptional()
  @IsDateString()
  supplier_invoice_date?: string;

  /**
   * CP-PURCHASE-TRANSPARENCY R2 — el total de la factura del proveedor se
   * persiste tal cual en `purchase_orders.supplier_invoice_amount` y es la
   * cifra contra la que el operador concilia el adjunto. Un negativo no es una
   * factura: es una nota crédito, y esa viaja por devoluciones a proveedor.
   * `0` sí se admite (una remisión sin valor declarado).
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  supplier_invoice_amount?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  /**
   * FASE TRACK B2/B4 — liga este adjunto a un pago concreto
   * (`purchase_order_payments.id`), habilitando el comprobante-por-pago y el
   * preview del modal de detalle. Llega por multipart como string y el
   * ValidationPipe global (transform + enableImplicitConversion) lo castea a
   * number. Sin este campo, `forbidNonWhitelisted:true` rechazaría el POST.
   */
  @IsOptional()
  @IsNumber()
  // Es una FK a `purchase_order_payments.id`: los identificadores de esa tabla
  // son autoincrementales y arrancan en 1, así que 0 y los negativos no
  // designan ninguna fila posible.
  @IsPositive()
  payment_id?: number;
}
