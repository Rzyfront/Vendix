import {
  IsString,
  IsOptional,
  IsInt,
  IsNotEmpty,
  MinLength,
  MaxLength,
  Min,
  Max,
  IsEnum,
  IsBoolean,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { PartialType } from '@nestjs/mapped-types';

export enum ReviewState {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  HIDDEN = 'hidden',
  FLAGGED = 'flagged',
}

export class ReviewQueryDto {
  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  limit?: number = 10;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  sort_by?: string = 'created_at';

  @IsOptional()
  @IsString()
  sort_order?: 'asc' | 'desc' = 'desc';

  @IsOptional()
  @IsEnum(ReviewState)
  state?: ReviewState;

  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  product_id?: number;

  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  user_id?: number;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  verified_purchase?: boolean;
}

export class CreateReviewResponseDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  @MaxLength(2000)
  content: string;
}

export class UpdateReviewResponseDto extends PartialType(
  CreateReviewResponseDto,
) {}
