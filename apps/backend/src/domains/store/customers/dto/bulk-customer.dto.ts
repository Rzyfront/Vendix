import {
  IsArray,
  IsEmail,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class BulkCustomerItemDto {
  @ApiPropertyOptional({ example: 'maria.garcia@email.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ example: 'Maria' })
  @IsString()
  @IsNotEmpty()
  first_name: string;

  @ApiProperty({ example: 'Garcia' })
  @IsString()
  @IsNotEmpty()
  last_name: string;

  @ApiPropertyOptional({ example: '12345678' })
  @IsString()
  @IsOptional()
  document_number?: string;

  @ApiPropertyOptional({ example: 'CC' })
  @IsString()
  @IsOptional()
  document_type?: string;

  @ApiPropertyOptional({ example: '3001234567' })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional({ example: 3 })
  @IsNumber()
  @IsOptional()
  row_number?: number;
}

export class BulkCustomerUploadDto {
  @ApiProperty({ type: [BulkCustomerItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkCustomerItemDto)
  customers: BulkCustomerItemDto[];
}

export class BulkCustomerUploadItemResultDto {
  @ApiPropertyOptional()
  customer?: any;

  @ApiProperty({ example: 'success' })
  status: 'success' | 'error';

  @ApiProperty({ example: 'Customer created successfully' })
  message: string;

  @ApiPropertyOptional({ example: 'ConflictException' })
  error?: string;

  @ApiPropertyOptional({ example: 3 })
  row_number?: number;
}

export class BulkCustomerUploadResultDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 10 })
  total_processed: number;

  @ApiProperty({ example: 8 })
  successful: number;

  @ApiProperty({ example: 2 })
  failed: number;

  @ApiProperty({ type: [BulkCustomerUploadItemResultDto] })
  results: BulkCustomerUploadItemResultDto[];
}
