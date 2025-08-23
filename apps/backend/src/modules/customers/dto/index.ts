import {
  IsString,
  IsOptional,
  IsInt,
  IsBoolean,
  IsEmail,
  IsPhoneNumber,
  IsDateString,
  MaxLength,
  Min,
  IsEnum,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { PartialType } from '@nestjs/mapped-types';

// Enums
export enum CustomerStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  BLOCKED = 'blocked',
}

export enum CustomerGender {
  MALE = 'male',
  FEMALE = 'female',
  OTHER = 'other',
}

// Create Customer DTO
export class CreateCustomerDto {
  @IsString()
  @MaxLength(100)
  first_name: string;

  @IsString()
  @MaxLength(100)
  last_name: string;

  @IsEmail()
  @MaxLength(255)
  email: string;

  @IsString()
  @IsOptional()
  @IsPhoneNumber()
  @MaxLength(20)
  phone?: string;

  @IsString()
  @IsOptional()
  @IsPhoneNumber()
  @MaxLength(20)
  mobile?: string;

  @IsDateString()
  @IsOptional()
  date_of_birth?: string;

  @IsEnum(CustomerGender)
  @IsOptional()
  gender?: CustomerGender;

  @IsInt()
  @Min(1)
  store_id: number;

  @IsInt()
  @IsOptional()
  @Min(1)
  organization_id?: number;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  notes?: string;

  @IsEnum(CustomerStatus)
  @IsOptional()
  status?: CustomerStatus = CustomerStatus.ACTIVE;

  @IsBoolean()
  @IsOptional()
  is_verified?: boolean = false;

  @IsBoolean()
  @IsOptional()
  marketing_consent?: boolean = false;
}

// Update Customer DTO
export class UpdateCustomerDto extends PartialType(CreateCustomerDto) {
  @IsInt()
  @IsOptional()
  @Min(1)
  store_id?: number;

  @IsInt()
  @IsOptional()
  @Min(1)
  organization_id?: number;
}

// Customer Query DTO
export class CustomerQueryDto {
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
  store_id?: number;

  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  organization_id?: number;

  @IsOptional()
  @IsEnum(CustomerStatus)
  status?: CustomerStatus;

  @IsOptional()
  @IsEnum(CustomerGender)
  gender?: CustomerGender;

  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  is_verified?: boolean;

  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  marketing_consent?: boolean;

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


