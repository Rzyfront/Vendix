import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** S6 — the choice for ONE completed production order of the cancelled sale. */
export class ProductionDispositionChoiceDto {
  @IsInt()
  production_order_id: number;

  @IsIn(['release', 'waste'])
  disposition: 'release' | 'waste';
}

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
   * when omitted every completed order is released (reuse) and the
   * cancellation is never blocked. Applies to every production order that has
   * no choice of its own in `productionDispositions`.
   */
  @IsOptional()
  @IsIn(['release', 'waste'])
  productionDisposition?: 'release' | 'waste';

  /** S6 — one choice per production order; wins over `productionDisposition`. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ProductionDispositionChoiceDto)
  productionDispositions?: ProductionDispositionChoiceDto[];

  /**
   * cod-auto-invoicing S5 — the operator confirmed that a TOTAL credit note is
   * emitted for every DIAN-accepted invoice of the order before cancelling.
   * Without it the ORD_CANCEL_CREDIT_NOTE_REQUIRED_001 guard applies as before.
   */
  @IsOptional()
  @IsBoolean()
  issueCreditNote?: boolean;
}
