import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Reasons a manager can pick; `ical` is written only by the iCal import (H6.2). */
export const MANUAL_BLOCK_REASONS = ['maintenance', 'owner_use'] as const;
export type ManualBlockReason = (typeof MANUAL_BLOCK_REASONS)[number];

/** Takes a room out of sale for the nights `[from_date, to_date)` (H5.3). */
export class CreateInventoryBlockDto {
  @ApiProperty({ description: 'Habitación a bloquear.' })
  @Type(() => Number)
  @IsInt()
  unit_id!: number;

  @ApiProperty({ example: '2026-11-10', description: 'Primera noche bloqueada.' })
  @Matches(DATE_ONLY)
  @IsDateString({ strict: true })
  from_date!: string;

  @ApiProperty({
    example: '2026-11-13',
    description: 'Día en que vuelve a la venta (esa noche no queda bloqueada).',
  })
  @Matches(DATE_ONLY)
  @IsDateString({ strict: true })
  to_date!: string;

  @ApiPropertyOptional({ enum: MANUAL_BLOCK_REASONS, default: 'maintenance' })
  @IsOptional()
  @IsIn(MANUAL_BLOCK_REASONS)
  reason?: ManualBlockReason;

  @ApiPropertyOptional({ example: 'Fuga en el baño', maxLength: 500 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  notes?: string;
}
