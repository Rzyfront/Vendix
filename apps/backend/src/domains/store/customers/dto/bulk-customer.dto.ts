import {
  IsArray,
  IsEmail,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { DOCUMENT_TYPE_CODES } from '../../../../common/constants/document-types';
import { DocumentNumberMatchesType } from '../../../../common/validators/document-number.validator';

export class BulkCustomerItemDto {
  @ApiPropertyOptional({ example: 'maria.garcia@email.com' })
  @Transform(({ value }) =>
    typeof value === 'string' && value.trim() === '' ? undefined : value,
  )
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: 'Maria' })
  @IsOptional()
  @IsString()
  first_name?: string;

  @ApiPropertyOptional({ example: 'Garcia' })
  @IsOptional()
  @IsString()
  last_name?: string;

  @ApiPropertyOptional({ example: '12345678' })
  @IsOptional()
  @IsString()
  @DocumentNumberMatchesType()
  document_number?: string;

  @ApiPropertyOptional({ example: 'CC', enum: DOCUMENT_TYPE_CODES })
  @IsOptional()
  @IsString()
  @IsIn(DOCUMENT_TYPE_CODES as unknown as string[], {
    message: 'document_type debe ser uno de los códigos DIAN válidos',
  })
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
