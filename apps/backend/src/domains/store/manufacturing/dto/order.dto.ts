import {
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

export const ORDER_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type OrderPriority = (typeof ORDER_PRIORITIES)[number];

export const ORDER_STATUSES = [
  'draft',
  'released',
  'in_progress',
  'partially_completed',
  'completed',
  'cancelled',
] as const;
export type ManufacturingOrderStatus = (typeof ORDER_STATUSES)[number];

export class CreateManufacturingOrderDto {
  @IsInt()
  @IsPositive()
  @Type(() => Number)
  recipe_id!: number;

  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001)
  @Type(() => Number)
  planned_qty!: number;

  @IsOptional()
  @IsDateString()
  due_date?: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  @Type(() => Number)
  location_id?: number;

  @IsOptional()
  @IsIn(ORDER_PRIORITIES as unknown as string[])
  priority?: OrderPriority;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class UpdateManufacturingOrderDto {
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001)
  @Type(() => Number)
  planned_qty?: number;

  @IsOptional()
  @IsDateString()
  due_date?: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  @Type(() => Number)
  location_id?: number;

  @IsOptional()
  @IsIn(ORDER_PRIORITIES as unknown as string[])
  priority?: OrderPriority;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class CompleteBatchDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  batch_number?: string;

  @IsOptional()
  @IsDateString()
  manufacturing_date?: string;

  @IsOptional()
  @IsDateString()
  expiration_date?: string;
}

export class CompleteManufacturingOrderDto {
  /** Por defecto, lo que falta por producir. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001)
  @Type(() => Number)
  produced_qty?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  @Type(() => Number)
  location_id?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => CompleteBatchDto)
  batch?: CompleteBatchDto;
}

export class ManufacturingOrderQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 25;

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @IsIn(ORDER_STATUSES as unknown as string[])
  status?: ManufacturingOrderStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  product_id?: number;

  @IsOptional()
  @IsDateString()
  date_from?: string;

  @IsOptional()
  @IsDateString()
  date_to?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;
}
