import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** One account of the split: its folio lines and who pays it. */
export class FolioSplitAccountDto {
  /** "Empresa ABC", "Juan". Defaults to "Cuenta N". */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;

  /** Customer the account is invoiced to (company NIT or guest); none = consumidor final. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  customer_id?: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(300)
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  order_item_ids!: number[];
}

/** H3.8 — "Dividir" by items: every active folio line goes to one account. */
export class FolioSplitDto {
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => FolioSplitAccountDto)
  accounts!: FolioSplitAccountDto[];
}

/** Confirmation of the previewed split. */
export class ConfirmFolioSplitDto extends FolioSplitDto {
  /** `source_version` of the preview: the folio did not change since. */
  @IsString()
  @MaxLength(64)
  source_version!: string;

  @IsString()
  @Matches(/^[A-Za-z0-9-]{8,64}$/)
  request_id!: string;
}

/** "Quitar división" before any account is paid. */
export class CancelFolioSplitDto {
  @IsString()
  @MaxLength(64)
  source_version!: string;
}

/** "Cobrar" one account with a manual method (cash, card, transfer). */
export class FolioSplitPayDto {
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  store_payment_method_id!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  /** Cash handed by the guest (change); optional. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount_received?: number;

  @IsString()
  @Matches(/^[A-Za-z0-9-]{8,64}$/)
  request_id!: string;
}
