import { IsDateString, IsNumber, IsOptional, IsString } from 'class-validator';

export class AddAttachmentDto {
  @IsOptional()
  @IsString()
  supplier_invoice_number?: string;

  @IsOptional()
  @IsDateString()
  supplier_invoice_date?: string;

  @IsOptional()
  @IsNumber()
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
  payment_id?: number;
}
