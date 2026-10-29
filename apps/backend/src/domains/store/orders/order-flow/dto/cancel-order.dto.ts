import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CancelOrderDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason: string;

  @IsOptional()
  @IsIn(['reuse', 'waste'])
  kitchenDisposition?: 'reuse' | 'waste';

  /**
   * cod-auto-invoicing S5 — the operator confirmed that a TOTAL credit note is
   * emitted for every DIAN-accepted invoice of the order before cancelling.
   * Without it the ORD_CANCEL_CREDIT_NOTE_REQUIRED_001 guard applies as before.
   */
  @IsOptional()
  @IsBoolean()
  issueCreditNote?: boolean;
}
