import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { identification_type_enum } from '@prisma/client';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Hospitality Suite (H3.1) — holder or companion of a reservation. The TRA
 * and SIRE fields are optional here so the desk gets the exact message of
 * what is missing ("Falta ciudad de residencia", see lodging-guest-rules).
 * Create and edit send the whole form.
 */
export class LodgingGuestDto {
  @ApiProperty({
    required: false,
    description: 'Habitación de la reserva; se puede omitir si la reserva tiene una sola.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  reservation_room_id?: number;

  @ApiProperty({ required: false, description: 'Perfil de cliente existente del huésped.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  customer_id?: number;

  @ApiProperty({ required: false, description: 'Titular de la reserva.' })
  @IsOptional()
  @IsBoolean()
  is_primary?: boolean;

  @ApiProperty({ required: false, enum: identification_type_enum })
  @IsOptional()
  @IsEnum(identification_type_enum)
  document_type?: identification_type_enum;

  @ApiProperty({ required: false, example: '1020304050' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(50)
  document_number?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  first_name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  last_name?: string;

  @ApiProperty({
    required: false,
    example: 'US',
    description: 'ISO 3166-1 alfa-2. Obligatoria con pasaporte u otro documento extranjero.',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^([A-Z]{2})?$/)
  nationality_country_code?: string;

  @ApiProperty({ required: false, example: '1990-05-01', description: 'Obligatoria si reporta SIRE.' })
  @IsOptional()
  @Matches(DATE_ONLY)
  @IsDateString({ strict: true })
  birth_date?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  residence_city?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  origin_city?: string;

  @ApiProperty({ required: false, example: 'vacation', description: 'Código de TRAVEL_PURPOSES.' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  travel_purpose?: string;

  @ApiProperty({ required: false, example: 'PIP-5', description: 'Sello o permiso de ingreso (PIP/TP/PT).' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(20)
  entry_permit_type?: string;

  @ApiProperty({ required: false, description: 'No residente en Colombia.' })
  @IsOptional()
  @IsBoolean()
  is_non_resident?: boolean;

  @ApiProperty({ description: 'Aceptó el aviso de tratamiento de datos (Ley 1581).' })
  @Equals(true, { message: 'Debes aceptar el aviso de tratamiento de datos' })
  data_consent!: boolean;
}
