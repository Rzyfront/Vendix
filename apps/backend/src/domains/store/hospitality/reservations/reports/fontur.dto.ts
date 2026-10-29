import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** H4.4 — quarter of the Fontur report. Both omitted = the last closed quarter of the store. */
export class LodgingFonturQueryDto {
  @ApiPropertyOptional({ description: 'Año (por ejemplo 2026).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;

  @ApiPropertyOptional({ description: 'Trimestre (1 a 4).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4)
  quarter?: number;
}
