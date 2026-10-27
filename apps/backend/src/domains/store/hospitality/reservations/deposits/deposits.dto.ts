import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, IsPositive, IsString, Matches } from 'class-validator';

/** H3.5 — deposit taken at the desk (cash, card or transfer). */
export class CollectDepositDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  store_payment_method_id!: number;

  /** Client key of this attempt: a double click registers it once. */
  @IsString()
  @Matches(/^[A-Za-z0-9-]{8,64}$/)
  request_id!: string;
}

/** H3.5 — Wompi payment link for the deposit. */
export class DepositLinkDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  /** Client key of this attempt: a double click creates one link. */
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9-]{8,64}$/)
  request_id?: string;
}
