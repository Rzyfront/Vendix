import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export const TABLE_STATUS_VALUES = [
  'available',
  'occupied',
  'reserved',
  'cleaning',
] as const;

export type TableStatus = (typeof TABLE_STATUS_VALUES)[number];

/**
 * DTO to create a physical restaurant table.
 *
 * Restaurant Suite — Fase E. The `store_id` is taken from the request
 * context (auto-scoping), never from the body.
 */
export class CreateTableDto {
  @IsString()
  @MaxLength(100)
  @Matches(/^[\p{L}0-9_\-/\.\s]+$/u, {
    message: 'Nombre de mesa inválido',
  })
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  zone?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  capacity?: number;

  @IsOptional()
  @IsIn(TABLE_STATUS_VALUES as readonly string[])
  status?: TableStatus;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  pos_x?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  pos_y?: number;
}

/**
 * DTO to update an existing table. All fields optional — only provided
 * fields are updated.
 */
export class UpdateTableDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(/^[\p{L}0-9_\-/\.\s]+$/u, {
    message: 'Nombre de mesa inválido',
  })
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  zone?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  capacity?: number;

  @IsOptional()
  @IsIn(TABLE_STATUS_VALUES as readonly string[])
  status?: TableStatus;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  pos_x?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  pos_y?: number;
}

/**
 * Query DTO for the tables list. Mirrors the standard store pagination shape.
 */
export class TableQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 50;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsIn(TABLE_STATUS_VALUES as readonly string[])
  status?: TableStatus;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  zone?: string;
}
