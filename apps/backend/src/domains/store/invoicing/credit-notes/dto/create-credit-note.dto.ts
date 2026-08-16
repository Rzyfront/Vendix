import {
  IsString,
  IsNumber,
  IsOptional,
  IsEnum,
  IsArray,
  ValidateNested,
  IsDateString,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  CreateInvoiceItemDto,
  CreateInvoiceTaxDto,
} from '../../dto/create-invoice.dto';

export class CreateCreditNoteDto {
  @IsNumber()
  @Type(() => Number)
  related_invoice_id: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  /**
   * Fecha de emisión de la nota. Opcional: cuando no viene, el servicio la
   * resuelve como HOY en el huso horario de la tienda.
   *
   * Exigirla obligaba al frontend a derivar una fecha fiscal en el navegador,
   * que es justo de donde salen los desfases de un día. El modal de notas nunca
   * la capturó, así que el campo obligatorio sólo producía un 400.
   */
  @IsOptional()
  @IsDateString()
  issue_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  /**
   * Líneas de la nota. Opcional: sin ellas la nota es TOTAL y el servicio copia
   * las líneas de la factura que corrige, que es el caso más común (anulación)
   * y el único que la UI ofrece hoy.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateInvoiceItemDto)
  items?: CreateInvoiceItemDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateInvoiceTaxDto)
  taxes?: CreateInvoiceTaxDto[];
}

export class CreateDebitNoteDto {
  @IsNumber()
  @Type(() => Number)
  related_invoice_id: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  /**
   * Fecha de emisión de la nota. Opcional: cuando no viene, el servicio la
   * resuelve como HOY en el huso horario de la tienda.
   *
   * Exigirla obligaba al frontend a derivar una fecha fiscal en el navegador,
   * que es justo de donde salen los desfases de un día. El modal de notas nunca
   * la capturó, así que el campo obligatorio sólo producía un 400.
   */
  @IsOptional()
  @IsDateString()
  issue_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  /**
   * Líneas de la nota. Opcional: sin ellas la nota es TOTAL y el servicio copia
   * las líneas de la factura que corrige, que es el caso más común (anulación)
   * y el único que la UI ofrece hoy.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateInvoiceItemDto)
  items?: CreateInvoiceItemDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateInvoiceTaxDto)
  taxes?: CreateInvoiceTaxDto[];
}
