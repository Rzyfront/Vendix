import { IsBoolean, IsIn, IsInt, IsOptional, IsPositive } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export const COST_METHODS = ['fifo', 'cpp'] as const;
export type ManufacturingCostMethod = (typeof COST_METHODS)[number];

export class UpdateManufacturingSettingsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  default_input_location_id?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  default_output_location_id?: number | null;

  @IsOptional()
  @IsIn(COST_METHODS as unknown as string[])
  cost_method?: ManufacturingCostMethod;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) =>
    typeof value === 'string' ? value === 'true' : value,
  )
  lot_required?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  wip_account_id?: number | null;
}
