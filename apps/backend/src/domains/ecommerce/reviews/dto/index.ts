import {
  IsInt,
  IsOptional,
  IsString,
  IsBoolean,
  IsIn,
  Min,
  Max,
  MinLength,
  MaxLength,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class CreateReviewDto {
  @IsInt()
  @Type(() => Number)
  product_id: number;

  @IsInt()
  @Min(1)
  @Max(5)
  @Type(() => Number)
  rating: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  comment: string;
}

export class UpdateReviewDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  @Type(() => Number)
  rating?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  comment?: string;
}

export class ReviewListQueryDto {
  @IsInt()
  @Transform(({ value }) => parseInt(value, 10))
  product_id: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Transform(({ value }) => (value ? parseInt(value, 10) : 1))
  page?: number = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  @Transform(({ value }) => (value ? parseInt(value, 10) : 10))
  limit?: number = 10;

  @IsOptional()
  @IsIn(['recent', 'helpful'])
  sort_by?: 'recent' | 'helpful' = 'recent';

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  @Transform(({ value }) => (value ? parseInt(value, 10) : undefined))
  rating?: number;
}

export class VoteReviewDto {
  @IsBoolean()
  is_helpful: boolean;
}

export class ReportReviewDto {
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason: string;
}
