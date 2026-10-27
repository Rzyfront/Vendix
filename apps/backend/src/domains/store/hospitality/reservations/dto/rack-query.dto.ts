import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, Matches } from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Rack window: first night shown and the exclusive end (YYYY-MM-DD). */
export class RackQueryDto {
  @ApiProperty({ description: 'Primera noche, fecha civil de la tienda (YYYY-MM-DD).' })
  @Matches(DATE_ONLY)
  @IsDateString({ strict: true })
  from!: string;

  @ApiProperty({ description: 'Fin exclusivo: esa noche no se muestra (YYYY-MM-DD).' })
  @Matches(DATE_ONLY)
  @IsDateString({ strict: true })
  to!: string;
}
