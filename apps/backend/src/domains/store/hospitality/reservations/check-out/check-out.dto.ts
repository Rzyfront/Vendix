import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsPositive, IsString, Matches } from 'class-validator';

/**
 * H3.7 — check-out: the balance is paid with a manual method or charged to
 * the company's credit; the invoice goes to the holder or to `bill_to`.
 */
export class CheckOutDto {
  /** Method that pays the balance (cash, card or transfer). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  store_payment_method_id?: number;

  /** "Cargar a crédito de la empresa": the balance goes to receivables. */
  @IsOptional()
  @IsBoolean()
  charge_to_credit?: boolean;

  /** "Facturar a empresa (NIT)": customer the invoice is issued to. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  bill_to_customer_id?: number;

  /** The user (holding store:lodging:folio:verify) verifies it now (D11). */
  @IsOptional()
  @IsBoolean()
  verify?: boolean;

  /** Client key of this check-out attempt: the balance is paid once. */
  @IsString()
  @Matches(/^[A-Za-z0-9-]{8,64}$/)
  request_id!: string;
}
