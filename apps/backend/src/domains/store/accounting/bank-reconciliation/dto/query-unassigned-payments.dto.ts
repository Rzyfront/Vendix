import { IsNumber, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Query del listado de pagos sin asignar (payments.bank_account_id IS NULL).
 *
 * CP-POLLO-ARABE-727 / E.2 (cross-ref QUI-728).
 * Paginación server-side (page/limit) cumpliendo la regla de listados de Vendix.
 */
export class QueryUnassignedPaymentsDto {
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  page?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  limit?: number;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  date_from?: string;

  @IsOptional()
  @IsString()
  date_to?: string;
}
