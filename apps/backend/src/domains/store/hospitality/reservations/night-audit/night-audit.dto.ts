import { IsBoolean, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** H7.1 — business day shown by "Cerrar día" (default: the current one). */
export class NightAuditQueryDto {
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'date debe tener formato YYYY-MM-DD' })
  date?: string;
}

/** H7.1 — "Cerrar día". */
export class CloseNightAuditDto {
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'date debe tener formato YYYY-MM-DD' })
  date?: string;

  /** Pending arrivals of the day become no-show (default true). */
  @IsOptional()
  @IsBoolean()
  mark_no_shows?: boolean;
}

/** H7.1 — "Reabrir día": requires a reason. */
export class ReopenNightAuditDto {
  @Matches(DATE_ONLY, { message: 'date debe tener formato YYYY-MM-DD' })
  date!: string;

  @IsString()
  @MinLength(3, { message: 'Escribe el motivo de la reapertura' })
  @MaxLength(500)
  reason!: string;
}
