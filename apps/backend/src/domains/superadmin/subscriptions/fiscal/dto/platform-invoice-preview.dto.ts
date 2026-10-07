import { PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, ValidateNested } from 'class-validator';
import {
  CreatePlatformSalesInvoiceDto,
  MvpV1InvoiceLineDto,
} from './subscription-fiscal.dto';

/**
 * Cuerpo de la previsualización de una factura de plataforma: el MISMO DTO de
 * creación, con todo opcional salvo `items` (lo que el formulario aún no ha
 * capturado, p. ej. el cliente, no debe impedir calcular los totales).
 */
export class PreviewPlatformSalesInvoiceDto extends PartialType(
  CreatePlatformSalesInvoiceDto,
) {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => MvpV1InvoiceLineDto)
  items!: MvpV1InvoiceLineDto[];
}
