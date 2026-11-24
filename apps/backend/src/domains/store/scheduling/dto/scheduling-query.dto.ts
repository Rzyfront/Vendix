import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  SCHEDULING_EVENT_TYPES,
  SCHEDULING_STATUS_GROUPS,
  SchedulingEventType,
  SchedulingFilters,
  SchedulingStatusGroup,
} from '../scheduling.types';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MESSAGE = 'La fecha debe tener el formato YYYY-MM-DD.';

/** `a,b` o `?x=a&x=b` → `['a','b']` (sin vacíos). */
function csv({ value }: { value: unknown }): string[] | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parts = (Array.isArray(value) ? value : String(value).split(','))
    .map((part) => String(part).trim())
    .filter(Boolean);
  return parts.length ? parts : undefined;
}

function csvInts(input: { value: unknown }): number[] | undefined {
  const parts = csv(input);
  return parts?.map((part) => Number(part));
}

/** Filtros comunes de Programación y Agenda. */
export class SchedulingFiltersDto {
  @ApiPropertyOptional({ example: 'booking,scheduled_order' })
  @IsOptional()
  @Transform(csv)
  @IsArray()
  @IsIn(SCHEDULING_EVENT_TYPES, { each: true })
  types?: SchedulingEventType[];

  @ApiPropertyOptional({ example: 'pending,confirmed' })
  @IsOptional()
  @Transform(csv)
  @IsArray()
  @IsIn(SCHEDULING_STATUS_GROUPS, { each: true })
  status_groups?: SchedulingStatusGroup[];

  @ApiPropertyOptional({ example: '3,7', description: 'Proveedores de servicio' })
  @IsOptional()
  @Transform(csvInts)
  @IsArray()
  @ArrayMaxSize(50)
  @IsInt({ each: true })
  @Min(1, { each: true })
  staff_ids?: number[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class SchedulingListQueryDto extends SchedulingFiltersDto {
  @ApiPropertyOptional({ example: '2026-11-23' })
  @IsOptional()
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  from?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  to?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class SchedulingCalendarQueryDto extends SchedulingFiltersDto {
  @ApiProperty({ example: '2026-11-01' })
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  from: string;

  @ApiProperty({ example: '2026-11-30' })
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  to: string;
}

/** DTO → filtros del servicio (el orden por defecto es cronológico). */
export function toSchedulingFilters(
  dto: SchedulingFiltersDto & { from?: string; to?: string; order?: 'asc' | 'desc' },
): SchedulingFilters {
  return {
    types: dto.types,
    status_groups: dto.status_groups,
    staff_ids: dto.staff_ids,
    search: dto.search?.trim() || undefined,
    from: dto.from,
    to: dto.to,
    order: dto.order === 'desc' ? 'desc' : 'asc',
  };
}
