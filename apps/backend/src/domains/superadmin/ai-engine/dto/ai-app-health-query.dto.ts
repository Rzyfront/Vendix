import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * `GET superadmin/ai-engine/app-health` (ia-cargas F6). Without dates the
 * board shows the last 7 days; the service clamps wider ranges.
 */
export class AIAppHealthQueryDto {
  @IsOptional()
  @IsDateString()
  date_from?: string;

  @IsOptional()
  @IsDateString()
  date_to?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  app_key?: string;
}
