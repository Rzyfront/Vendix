import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/** `overdue` = pending rows older than the store threshold. */
export const SIRE_FILTERS = ['pending', 'overdue', 'manual'] as const;

export class SireListQueryDto {
  @ApiProperty({ required: false, example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiProperty({ required: false, example: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiProperty({ required: false, description: 'Huésped, documento o número de reserva' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiProperty({ required: false, enum: SIRE_FILTERS })
  @IsOptional()
  @IsIn(SIRE_FILTERS as unknown as string[])
  status?: (typeof SIRE_FILTERS)[number];
}

export class SireMarkReportedDto {
  @ApiProperty({ type: [Number] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsInt({ each: true })
  ids!: number[];
}
