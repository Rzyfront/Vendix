import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

/** Highest monthly SMS cap a store can set, in USD. */
export const MAX_MONTHLY_SMS_SPEND_USD = 10_000;

export class UpdateSmsChannelDto {
  @IsBoolean()
  enabled!: boolean;

  /**
   * Alphanumeric SNS Sender ID (1-11 characters, at least one letter). Only
   * countries that support it show it; Colombia ignores it. `null` clears it.
   */
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() || null : value,
  )
  @IsString()
  @Matches(/^(?=.*[A-Za-z])[A-Za-z0-9]{1,11}$/, {
    message:
      'sender_id debe tener de 1 a 11 letras o números, con al menos una letra',
  })
  sender_id?: string | null;

  /** Hard monthly cap in USD; `0` blocks every SMS. */
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(MAX_MONTHLY_SMS_SPEND_USD)
  monthly_spend_limit!: number;
}
