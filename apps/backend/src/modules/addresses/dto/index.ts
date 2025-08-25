import {
  IsString,
  IsOptional,
  IsInt,
  IsBoolean,
  IsNumber,
  MaxLength,
  Min,
  IsEnum,
  IsLatLong,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { PartialType } from '@nestjs/mapped-types';

// Enums
export enum AddressStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

export enum AddressType {
  BILLING = 'billing',
  SHIPPING = 'shipping',
  HEADQUARTERS = 'headquarters',
  BRANCH_OFFICE = 'branch_office',
  WAREHOUSE = 'warehouse',
  LEGAL = 'legal',
  STORE_PHYSICAL = 'store_physical',
}

// Create Address DTO
export class CreateAddressDto {
  @IsString()
  @MaxLength(255)
  address_line_1: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  address_line_2?: string;

  @IsString()
  @MaxLength(100)
  city: string;

  @IsString()
  @MaxLength(100)
  state: string;

  @IsString()
  @MaxLength(20)
  postal_code: string;

  @IsString()
  @MaxLength(100)
  country: string;
  @IsEnum(AddressType)
  @IsOptional()
  type?: AddressType = AddressType.SHIPPING;

  @IsInt()
  @IsOptional()
  @Min(1)
  customer_id?: number;

  @IsInt()
  @IsOptional()
  @Min(1)
  store_id?: number;

  @IsBoolean()
  @IsOptional()
  is_default?: boolean = false;

  @IsString()
  @IsOptional()
  @IsLatLong()
  latitude?: string;

  @IsString()
  @IsOptional()
  @IsLatLong()
  longitude?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  landmark?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  delivery_instructions?: string;

  @IsEnum(AddressStatus)
  @IsOptional()
  status?: AddressStatus = AddressStatus.ACTIVE;
}

// Update Address DTO
export class UpdateAddressDto extends PartialType(CreateAddressDto) {}

// Address Query DTO
export class AddressQueryDto {
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
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  customer_id?: number;

  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  store_id?: number;

  @IsOptional()
  @IsEnum(AddressType)
  type?: AddressType;

  @IsOptional()
  @IsEnum(AddressStatus)
  status?: AddressStatus;

  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  is_default?: boolean;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  sort_by?: string = 'created_at';

  @IsOptional()
  @IsString()
  sort_order?: 'asc' | 'desc' = 'desc';

  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  include_inactive?: boolean = false;
}

// GPS Coordinates DTO
export class UpdateGPSCoordinatesDto {
  @IsString()
  @IsLatLong()
  latitude: string;

  @IsString()
  @IsLatLong()
  longitude: string;
}
