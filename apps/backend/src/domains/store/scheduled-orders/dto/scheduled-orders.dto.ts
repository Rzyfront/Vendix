import { ApiProperty } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Bloque opcional `schedule` del POS y del checkout. Instantes ISO (UTC). */
export class ScheduleInputDto {
  @ApiProperty({ example: '2026-11-03T15:00:00.000Z', description: 'Inicio de la franja' })
  @IsDateString()
  start: string;

  @ApiProperty({ example: '2026-11-03T17:00:00.000Z', description: 'Fin de la franja' })
  @IsDateString()
  end: string;

  @ApiProperty({ enum: ['pickup', 'delivery'], required: false, default: 'pickup' })
  @IsOptional()
  @IsIn(['pickup', 'delivery'])
  fulfillment_type?: 'pickup' | 'delivery';

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class AgendaQueryDto {
  @ApiProperty({ example: '2026-11-02' })
  @Matches(DATE_ONLY, { message: 'La fecha debe tener el formato YYYY-MM-DD.' })
  from: string;

  @ApiProperty({ example: '2026-11-08' })
  @Matches(DATE_ONLY, { message: 'La fecha debe tener el formato YYYY-MM-DD.' })
  to: string;

  @ApiProperty({ required: false, example: 'scheduled,ready', description: 'Estados separados por coma' })
  @IsOptional()
  @Matches(/^(scheduled|in_production|ready|delivered|no_show|cancelled)(,(scheduled|in_production|ready|delivered|no_show|cancelled))*$/, {
    message: 'Estado de pedido programado no válido.',
  })
  status?: string;
}

export class ProductionListQueryDto {
  @ApiProperty({ example: '2026-11-03' })
  @Matches(DATE_ONLY, { message: 'La fecha debe tener el formato YYYY-MM-DD.' })
  date: string;
}

export class TransitionScheduleDto {
  @ApiProperty({ enum: ['in_production', 'ready', 'delivered', 'no_show', 'cancelled'] })
  @IsIn(['in_production', 'ready', 'delivered', 'no_show', 'cancelled'])
  status: 'in_production' | 'ready' | 'delivered' | 'no_show' | 'cancelled';

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class RescheduleDto {
  @ApiProperty({ example: '2026-11-04T15:00:00.000Z' })
  @IsDateString()
  start: string;

  @ApiProperty({ example: '2026-11-04T17:00:00.000Z' })
  @IsDateString()
  end: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
