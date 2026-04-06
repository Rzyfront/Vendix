import { IsOptional, IsIn } from 'class-validator';
import type { Granularity, Period } from '../constants/cloudwatch.constants';

export class MetricsQueryDto {
  @IsOptional()
  @IsIn(['1h', '6h', '24h', '7d'])
  period?: Period = '1h';

  @IsOptional()
  @IsIn(['1m', '5m', '15m', '1h'])
  granularity?: Granularity;
}
