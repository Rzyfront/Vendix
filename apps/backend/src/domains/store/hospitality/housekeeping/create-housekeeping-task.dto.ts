import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { lodging_housekeeping_task_type_enum } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

/** U12 — a task asked by hand (inspection, repair, a clean without departure). */
export class CreateHousekeepingTaskDto {
  @ApiProperty()
  @IsInt()
  @IsPositive()
  unit_id: number;

  @ApiProperty({ enum: lodging_housekeeping_task_type_enum })
  @IsEnum(lodging_housekeeping_task_type_enum)
  type: lodging_housekeeping_task_type_enum;

  /** YYYY-MM-DD in the store's time zone; today when omitted. */
  @ApiPropertyOptional({ example: '2026-11-10' })
  @IsOptional()
  @IsDateString({ strict: true })
  task_date?: string;

  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  @IsPositive()
  assigned_user_id?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;
}
