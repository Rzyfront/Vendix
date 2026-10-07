import { Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

const POSITIVE_QUANTITY_15_4 = /^(?=.*[1-9])(?:0|[1-9]\d{0,10})(?:\.\d{1,4})?$/;
const NONNEGATIVE_MONEY_15_2 = /^(?:0|[1-9]\d{0,12})(?:\.\d{1,2})?$/;
const NO_CONTROL_CHARACTERS = /^[^\x00-\x1f\x7f]+$/;

function trimText(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function normalizeSearch(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;
}

function strictInteger(value: unknown): unknown {
  if (typeof value === 'number') return value;
  return typeof value === 'string' && /^[0-9]+$/.test(value) ? Number(value) : value;
}

export class ReceivedDocumentMatchCandidatesQueryDto {
  @IsOptional()
  @Transform(({ value }) => normalizeSearch(value))
  @IsString()
  @Length(1, 100)
  search?: string;

  @IsOptional()
  @Transform(({ value }) => strictInteger(value))
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number;

  @IsOptional()
  @Transform(({ value }) => strictInteger(value))
  @IsInt()
  @Min(1)
  @Max(2147483647)
  store_id?: number;
}

/** Typed proposal accepted by the future match-confirm service. Cross-target
 * XOR, parent, unit conversion, currency, and cumulative allocation rules are
 * deliberately enforced by the domain transaction/database instead. */
export class ConfirmReceivedDocumentMatchDto {
  @Transform(({ value }) => strictInteger(value))
  @IsInt()
  @Min(1)
  @Max(2147483647)
  expected_version!: number;

  @IsUUID('4')
  idempotency_key!: string;

  @Transform(({ value }) => strictInteger(value))
  @IsInt()
  @Min(1)
  @Max(2147483647)
  document_item_id!: number;

  @IsOptional()
  @Transform(({ value }) => strictInteger(value))
  @IsInt()
  @Min(1)
  @Max(2147483647)
  purchase_order_id?: number;

  @IsOptional()
  @Transform(({ value }) => strictInteger(value))
  @IsInt()
  @Min(1)
  @Max(2147483647)
  purchase_order_item_id?: number;

  @IsOptional()
  @Transform(({ value }) => strictInteger(value))
  @IsInt()
  @Min(1)
  @Max(2147483647)
  reception_id?: number;

  @IsOptional()
  @Transform(({ value }) => strictInteger(value))
  @IsInt()
  @Min(1)
  @Max(2147483647)
  reception_item_id?: number;

  @IsOptional()
  @Transform(({ value }) => strictInteger(value))
  @IsInt()
  @Min(1)
  @Max(2147483647)
  expense_id?: number;

  @IsOptional()
  @Transform(({ value }) => strictInteger(value))
  @IsInt()
  @Min(1)
  @Max(2147483647)
  expense_item_id?: number;

  @IsString()
  @Matches(POSITIVE_QUANTITY_15_4)
  source_quantity!: string;

  @IsOptional()
  @IsString()
  @Matches(POSITIVE_QUANTITY_15_4)
  target_quantity?: string;

  @IsOptional()
  @Transform(({ value }) => trimText(value))
  @IsString()
  @Length(1, 30)
  @Matches(NO_CONTROL_CHARACTERS)
  target_unit_code?: string;

  @IsString()
  @Matches(NONNEGATIVE_MONEY_15_2)
  allocated_net_amount!: string;

  @IsOptional()
  @Transform(({ value }) => trimText(value))
  @IsString()
  @Length(10, 500)
  @Matches(NO_CONTROL_CHARACTERS)
  manual_reason?: string;
}

export class RevokeReceivedDocumentMatchDto {
  @Transform(({ value }) => strictInteger(value))
  @IsInt()
  @Min(1)
  @Max(2147483647)
  expected_version!: number;

  @Transform(({ value }) => trimText(value))
  @IsString()
  @Length(10, 500)
  @Matches(NO_CONTROL_CHARACTERS)
  reason!: string;
}
