import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** QUI-1013 — a production plant: name, input/output locations, optional manager. */
export class CreateManufacturingPlantDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'El nombre de la planta es obligatorio' })
  @MaxLength(100)
  name!: string;

  /** Location the plant consumes its inputs from. */
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  input_location_id!: number;

  /** Location the plant puts its finished goods into. */
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  output_location_id!: number;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  manager_user_id?: number | null;
}

export class UpdateManufacturingPlantDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'El nombre de la planta es obligatorio' })
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  input_location_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  output_location_id?: number;

  /** `null` removes the manager. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  manager_user_id?: number | null;

  /** `false` deactivates the plant (blocked while it has open orders). */
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) =>
    typeof value === 'string' ? value === 'true' : value,
  )
  is_active?: boolean;
}

export class ManufacturingPlantQueryDto {
  /** Include deactivated plants (settings screen). Default: only active ones. */
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) =>
    typeof value === 'string' ? value === 'true' : value,
  )
  include_inactive?: boolean;
}

export class ManufacturingPlantManagersQueryDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
