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
   * QUI-995 — what to do with finished goods already produced for this sale:
   * `release` returns them to sellable stock, `waste` writes them off. Optional:
   * when omitted the system suggests one (waste if any linked line has add-ons
   * or notes, else release) and the cancellation is never blocked.
   */
  @IsOptional()
  @IsIn(['release', 'waste'])
  productionDisposition?: 'release' | 'waste';

  /**
   * cod-auto-invoicing S5 — the operator confirmed that a TOTAL credit note is
   * emitted for every DIAN-accepted invoice of the order before cancelling.
   * Without it the ORD_CANCEL_CREDIT_NOTE_REQUIRED_001 guard applies as before.
   */
  @IsOptional()
  @IsBoolean()
  issueCreditNote?: boolean;
}
