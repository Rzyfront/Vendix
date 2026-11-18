import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** Filtros de la lista de alertas del bot de monitoreo (QUI-1010). */
export class PlatformAlertsQueryDto {
  @IsOptional()
  @IsIn(['open', 'resolved', 'all'])
  status?: 'open' | 'resolved' | 'all' = 'open';

  @IsOptional()
  @IsIn(['info', 'warning', 'critical'])
  severity?: 'info' | 'warning' | 'critical';

  @IsOptional()
  @IsIn([
    'http',
    'latency',
    'job',
    'job_stalled',
    'queue_stalled',
    'worker',
    'incident',
    'test',
  ])
  source?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

/** Alerta de prueba disparada desde Superadmin. */
export class PlatformTestAlertDto {
  @IsIn(['warning', 'critical'])
  severity!: 'warning' | 'critical';
}
