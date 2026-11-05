import { IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

/** Body of `POST store/reservations/:id/prepay-payment`: the prepay collected in person (S2). */
export class RegisterPrepayPaymentDto {
  /** Store payment method that received the money (cash, card, bank transfer...). */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  store_payment_method_id: number;

  /** Destination account of a bank transfer. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bank_account_id?: number;

  /** Defaults to what the charge still has pending. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'El valor debe tener máximo 2 decimales' })
  @Min(0.01, { message: 'El valor debe ser mayor a cero' })
  @Max(9_999_999_999.99)
  amount?: number;

  /** Free reference of the operation (voucher, transfer number). */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;

  /** Idempotency key of the dialog (one per open): a double submit registers one payment. */
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9-]{8,64}$/, { message: 'La llave del cobro no es válida' })
  request_id?: string;
}
