import {
  IsEmail,
  IsOptional,
  IsString,
  IsEnum,
  MinLength,
  Matches,
} from 'class-validator';
import { user_state_enum } from '@prisma/client';

export class CreateCustomerDto {
  @IsString()
  @MinLength(3)
  username: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(2)
  first_name: string;

  @IsString()
  @MinLength(2)
  last_name: string;

  @IsOptional()
  @Matches(/^[0-9+\-\s()]*$/, {
    message:
      'El teléfono solo puede contener números, espacios, guiones y paréntesis',
  })
  phone?: string;

  @IsOptional()
  @IsString()
  document_type?: string;

  @IsOptional()
  @IsString()
  document_number?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;
}

export class UpdateCustomerDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  username?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  first_name?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  last_name?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  document_type?: string;

  @IsOptional()
  @IsString()
  document_number?: string;
}

export class ChangeCustomerStatusDto {
  @IsEnum(user_state_enum)
  state: user_state_enum;
}

export class CustomerQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  state?: user_state_enum;

  @IsOptional()
  page?: number = 1;

  @IsOptional()
  limit?: number = 10;

  @IsOptional()
  @IsString()
  sort_by?: string = 'created_at';

  @IsOptional()
  @IsString()
  sort_order?: 'asc' | 'desc' = 'desc';
}

export class CustomerStatsDto {
  total_customers: number;
  active_customers: number;
  new_customers_this_month: number;
}
