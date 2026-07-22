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
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { vehicle_type_enum, settlement_type_enum } from '@prisma/client';

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

  // Plan Despacho Economía — FASE 1 paso 6.
  // La tarifa del vehículo (settlement_type / settlement_rate) define el costo
  // del ejecutor propio cuando se cierra una ruta DSD.
  @IsOptional()
  @IsEnum(settlement_type_enum)
  settlement_type?: settlement_type_enum;

  /**
   * `settlement_rate` es requerido si `settlement_type` ∈ {per_delivery, per_route}.
   * No se persiste si `settlement_type` es `none` o null.
   */
  @ValidateIf((o) => o.settlement_type && o.settlement_type !== 'none')
  @Transform(({ value }) => (value !== undefined && value !== null ? Number(value) : value))
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  settlement_rate?: number;
}