import { PartialType } from '@nestjs/mapped-types';
import { CreateVehicleDto } from './create-vehicle.dto';

/**
 * UpdateVehicleDto — todos los campos son opcionales (semántica de PATCH).
 *
 * Hereda los validators del CreateVehicleDto padre:
 *   - plate: @IsString() @MaxLength(20)
 *   - brand: @IsString() @IsNotEmpty() @MaxLength(80)
 *   - model_name: @IsString() @IsNotEmpty() @MaxLength(80)
 *   - capacity_kg: @IsNumber() @Min(0.01)
 *   - primary_driver_id: @IsInt() @Min(1)
 *   - type: @IsOptional() @IsEnum(vehicle_type_enum)
 *   - capacity_units: @IsOptional() @IsInt() @Min(0)
 *   - is_active: @IsOptional() @IsBoolean()
 *   - notes: @IsOptional() @IsString()
 *
 * Si el cliente envía `brand: ''` o `capacity_kg: 0`, el validator falla
 * (no son opcionales en el PATCH — son opcionales en el sentido de "no
 * obligatorio incluirlos", pero si se incluyen deben ser válidos).
 */
export class UpdateVehicleDto extends PartialType(CreateVehicleDto) {}
