import { IsString, IsOptional, IsDateString, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Query combinado del endpoint GET /store/accounting/reports/subsidiary-ledger.
 * Soporta dos modos mutuamente excluyentes, despachados en el controller:
 *   - Modo cuenta:  ?account_code=1435[&date_from&date_to]
 *   - Modo tercero: ?third_party_type=customer&third_party_id=N[&date_from&date_to]
 *
 * Todos los campos son opcionales a nivel de DTO (ValidationPipe con
 * `forbidNonWhitelisted: true` exige declarar ambos shapes en una sola
 * clase); la regla de "cuál modo aplica y qué es obligatorio en cada uno"
 * se valida explícitamente en el controller antes de invocar el service.
 */
export class SubsidiaryLedgerQueryDto {
  @IsOptional()
  @IsString()
  account_code?: string;

  @IsOptional()
  @IsString()
  third_party_type?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  third_party_id?: number;

  @IsOptional()
  @IsDateString()
  date_from?: string;

  @IsOptional()
  @IsDateString()
  date_to?: string;
}

/**
 * Shape validado internamente para el modo "por cuenta" (jerárquico
 * padre → hijas vía chart_of_accounts.parent_id).
 */
export interface SubsidiaryLedgerByAccountQueryDto {
  account_code: string;
  date_from?: string;
  date_to?: string;
}

/**
 * Shape validado internamente para el modo "por tercero" (snapshot histórico
 * third_party_id/type de accounting_entry_lines, M1+M2).
 */
export interface SubsidiaryLedgerByThirdPartyQueryDto {
  third_party_type: string;
  third_party_id: number;
  date_from?: string;
  date_to?: string;
}
