import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min, ValidateIf } from 'class-validator';

export class SetProductTemplateDto {
  /** `null` desvincula el servicio de cualquier plantilla. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  template_id: number | null;
}
