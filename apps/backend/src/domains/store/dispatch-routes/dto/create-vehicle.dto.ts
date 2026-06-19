import {
  IsString,
  IsOptional,
  IsInt,
  IsBoolean,
  IsNumber,
  IsEnum,
  Min,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { vehicle_type_enum } from '@prisma/client';

export class CreateVehicleDto {
  @IsString()
  @MaxLength(20)
  plate: string;

  @IsOptional()
  @IsEnum(vehicle_type_enum)
  type?: vehicle_type_enum;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  brand?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  model_name?: string;

  @IsOptional()
  @Transform(({ value }) => (value ? Number(value) : undefined))
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  capacity_kg?: number;

  @IsOptional()
  @Transform(({ value }) => (value ? parseInt(value) : undefined))
  @IsInt()
  @Min(0)
  capacity_units?: number;

  @IsOptional()
  @Transform(({ value }) => (value ? parseInt(value) : undefined))
  @IsInt()
  @Min(1)
  primary_driver_id?: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsString()
  notes?: string;
}
