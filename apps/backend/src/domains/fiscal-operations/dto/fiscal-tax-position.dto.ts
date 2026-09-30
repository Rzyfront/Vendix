import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';
import { CreateTaxDeclarationDraftDto } from './fiscal-operations.dto';

/**
 * Read-only fiscal position query. Tenant/entity selectors are intentionally
 * absent; the controllers derive fiscal scope from the authenticated context.
 */
export class FiscalTaxPositionQueryDto extends CreateTaxDeclarationDraftDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  obligation_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  store_id?: number;
}
