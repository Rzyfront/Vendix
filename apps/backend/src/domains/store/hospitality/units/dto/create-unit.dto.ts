import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Physical room of a hotel store: number, room type and location. */
export class CreateUnitDto {
  @ApiProperty({ description: 'Número o nombre de la habitación: "101", "Cabaña 1".' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  code!: string;

  @ApiProperty({ description: 'Tipo de habitación.' })
  @Type(() => Number)
  @IsInt()
  unit_type_id!: number;

  @ApiProperty({ required: false, description: 'Piso: "1", "PB".' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(30)
  floor?: string;

  @ApiProperty({ required: false, description: 'Zona o bloque: "Jardín", "Torre B".' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  zone?: string;
}

/** Several rooms of the same type at once ("101–110" expanded by the client). */
export class CreateUnitsBulkDto {
  @ApiProperty({ type: [String], description: 'Números de habitación (máximo 100).' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @Transform(({ value }) =>
    Array.isArray(value)
      ? value.map((v) => (typeof v === 'string' ? v.trim() : v))
      : value,
  )
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(30, { each: true })
  codes!: string[];

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  unit_type_id!: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(30)
  floor?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  zone?: string;
}
