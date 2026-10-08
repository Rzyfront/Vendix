import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

export enum OrderReviewQuickTag {
  very_easy = 'very_easy',
  normal = 'normal',
  difficult = 'difficult',
}

export const ORDER_REVIEW_SOURCES = [
  'order_confirmation',
  'order_detail',
] as const;
export type OrderReviewSource = (typeof ORDER_REVIEW_SOURCES)[number];

const trimOrNull = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateOrderReviewDto {
  @IsInt()
  @Min(1)
  @Max(5)
  @Type(() => Number)
  rating: number;

  @IsOptional()
  @IsEnum(OrderReviewQuickTag)
  quick_tag?: OrderReviewQuickTag;

  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(1000)
  comment?: string | null;

  @IsOptional()
  @IsIn(ORDER_REVIEW_SOURCES)
  source?: OrderReviewSource;
}

export class CreateOrderProductReviewDto {
  @IsInt()
  @Type(() => Number)
  product_id: number;

  @IsInt()
  @Min(1)
  @Max(5)
  @Type(() => Number)
  rating: number;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(255)
  title?: string;

  @Transform(trimString)
  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  comment: string;
}
