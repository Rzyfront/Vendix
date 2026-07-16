import {
  IsString,
  IsOptional,
  IsInt,
  IsBoolean,
  IsNumber,
  IsEnum,
  IsNotEmpty,
  Min,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { vehicle_type_enum } from '@prisma/client';

export class CreateVehicleDto {
  @IsString()
  @MaxLength(20)
  plate: string;

  // `type` se queda como @IsOptional porque Prisma tiene default `truck`.
  // Si el cliente lo envía, debe ser un valor válido del enum.
  @IsOptional()
  @IsEnum(vehicle_type_enum)
  type?: vehicle_type_enum;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  brand: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  model_name: string;

  // Capacidad > 0: un vehículo con capacidad 0 no tiene sentido operacional.
  // Defense-in-depth contra inserts accidentales con datos basura.
  @Transform(({ value }) => (value ? Number(value) : undefined))
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  capacity_kg: number;

  @IsOptional()
  @Transform(({ value }) => (value ? parseInt(value) : undefined))
  @IsInt()
  @Min(0)
  capacity_units?: number;

  // FK a users (mismo store_id). El service valida que el user exista
  // antes del insert para evitar 500 genérico por P2003.
  @Transform(({ value }) => (value ? parseInt(value) : undefined))
  @IsInt()
  @Min(1)
  primary_driver_id: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsString()
  notes?: string;
}
