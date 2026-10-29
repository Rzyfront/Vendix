import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const TRA_STATUSES = ['pending', 'sent', 'manual', 'failed'] as const;

export class TraListQueryDto {
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

  @ApiProperty({ required: false, enum: TRA_STATUSES })
  @IsOptional()
  @IsIn(TRA_STATUSES as unknown as string[])
  status?: (typeof TRA_STATUSES)[number];
}

export class TraIdsDto {
  @ApiProperty({ type: [Number], required: false, description: 'Sin ids: todos los pendientes' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsInt({ each: true })
  ids?: number[];
}

export class TraMarkReportedDto {
  @ApiProperty({ type: [Number] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsInt({ each: true })
  ids!: number[];
}

export class TraTokenDto {
  @ApiProperty({ description: 'Token que el MinCIT envía al correo del RNT' })
  @IsString()
  @MinLength(8)
  @MaxLength(2000)
  token!: string;
}
