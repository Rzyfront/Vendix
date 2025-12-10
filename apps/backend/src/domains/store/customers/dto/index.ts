import {
  IsString,
  IsEmail,
  IsOptional,
  IsEnum,
  IsNotEmpty,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { user_state_enum } from '@prisma/client';

export class CreateCustomerDto {
  @ApiProperty({ description: 'Username for the customer' })
  @IsString()
  @IsNotEmpty()
  username: string;

  @ApiProperty({ description: 'Email address' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({
    description: 'Password (optional, will be generated if not provided)',
  })
  @IsString()
  @IsOptional()
  @MinLength(6)
  password?: string;

  @ApiProperty({ description: 'First name' })
  @IsString()
  @IsNotEmpty()
  first_name: string;

  @ApiProperty({ description: 'Last name' })
  @IsString()
  @IsNotEmpty()
  last_name: string;

  @ApiPropertyOptional({ description: 'Phone number' })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional({ description: 'Document type (DNI, PASSPORT, etc.)' })
  @IsString()
  @IsOptional()
  document_type?: string;

  @ApiPropertyOptional({ description: 'Document number' })
  @IsString()
  @IsOptional()
  document_number?: string;
}

export class UpdateCustomerDto {
  @ApiPropertyOptional({ description: 'Username' })
  @IsString()
  @IsOptional()
  username?: string;

  @ApiPropertyOptional({ description: 'Email address' })
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({ description: 'First name' })
  @IsString()
  @IsOptional()
  first_name?: string;

  @ApiPropertyOptional({ description: 'Last name' })
  @IsString()
  @IsOptional()
  last_name?: string;

  @ApiPropertyOptional({ description: 'Phone number' })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional({ description: 'Document type' })
  @IsString()
  @IsOptional()
  document_type?: string;

  @ApiPropertyOptional({ description: 'Document number' })
  @IsString()
  @IsOptional()
  document_number?: string;
}

export class ChangeCustomerStatusDto {
  @ApiProperty({ description: 'New customer state', enum: user_state_enum })
  @IsEnum(user_state_enum)
  @IsNotEmpty()
  state: user_state_enum;
}

export class CustomerQueryDto {
  @ApiPropertyOptional({ description: 'Search term (name, email, username)' })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({
    description: 'Filter by state',
    enum: user_state_enum,
  })
  @IsEnum(user_state_enum)
  @IsOptional()
  state?: user_state_enum;

  @ApiPropertyOptional({ description: 'Page number', default: 1 })
  @IsOptional()
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Items per page', default: 10 })
  @IsOptional()
  limit?: number = 10;

  @ApiPropertyOptional({ description: 'Sort field', default: 'created_at' })
  @IsString()
  @IsOptional()
  sort_by?: string = 'created_at';

  @ApiPropertyOptional({ description: 'Sort order', default: 'desc' })
  @IsString()
  @IsOptional()
  sort_order?: 'asc' | 'desc' = 'desc';
}

export class CustomerStatsDto {
  @ApiProperty({ description: 'Total number of customers' })
  total_customers: number;

  @ApiProperty({ description: 'Number of active customers' })
  active_customers: number;

  @ApiProperty({ description: 'Number of new customers this month' })
  new_customers_this_month: number;
}
