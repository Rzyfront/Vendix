import {
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * QUI-728 — proyección mínima de una cuenta bancaria que viaja a la UI de
 * selección de transferencia: `{ id, name, bank_name, account_number }`.
 * NUNCA expone `current_balance`, `opening_balance`, `chart_account_id` ni
 * `column_mapping` (el saldo bancario no es asunto de una pantalla cuyo único
 * propósito es elegir a qué cuenta pagar). Vive en el módulo de payments — NO
 * es el endpoint contable de bank-reconciliation.
 *
 * `image_url` es la URL pre-firmada de S3 calculada en lectura (TTL 300s);
 * es opcional y de salida únicamente — nunca se persiste ni se valida con
 * class-validator. El S3 key crudo vive en `bank_accounts.image_s3_key`.
 */
export class BankAccountOptionDto {
  id: number;
  name: string;
  bank_name: string;
  account_number: string;
  image_url?: string | null;
}

export class CreateBankAccountDto {
  @IsString()
  @MaxLength(100)
  name: string;

  @IsString()
  @MaxLength(50)
  @Matches(/^[\d\s-]*$/, {
    message: 'El número de cuenta solo puede contener dígitos, espacios y guiones',
  })
  account_number: string;

  @IsString()
  @MaxLength(100)
  bank_name: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  bank_code?: string;

  /**
   * QUI-728 — S3 key del logo/imagen 21:9 de la cuenta. Opcional; validado
   * solo por longitud y tipo. La firma de la URL pre-firmada ocurre en
   * lectura, no en escritura.
   */
  @IsOptional()
  @IsString()
  @MaxLength(512)
  image_s3_key?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;
}

export class UpdateBankAccountDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  account_number?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  bank_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  bank_code?: string;

  /**
   * QUI-728 — S3 key del logo/imagen 21:9. Aceptado tanto en create como en
   * update; null/undefined ⇒ no se modifica.
   */
  @IsOptional()
  @IsString()
  @MaxLength(512)
  image_s3_key?: string;
}

export class BankAccountIdParamDto {
  @IsInt()
  @Min(1)
  @Type(() => Number)
  id: number;
}
