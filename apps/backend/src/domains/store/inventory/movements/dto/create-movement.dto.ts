import {
  IsNotEmpty,
  IsString,
  IsNumber,
  IsEnum,
  IsOptional,
  IsDateString,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { movement_type_enum } from '@prisma/client';

export class CreateMovementDto {
  @ApiProperty({ description: 'Product ID' })
  @IsNumber()
  @IsNotEmpty()
  product_id: number;

  @ApiProperty({ description: 'Product variant ID (optional)' })
  @IsNumber()
  @IsOptional()
  product_variant_id?: number;

  @ApiProperty({ description: 'Source location ID' })
  @IsNumber()
  @IsNotEmpty()
  from_location_id: number;

  @ApiProperty({ description: 'Destination location ID (optional)' })
  @IsNumber()
  @IsOptional()
  to_location_id?: number;

  @ApiProperty({ description: 'Movement type', enum: movement_type_enum })
  @IsEnum(movement_type_enum)
  @IsNotEmpty()
  movement_type: movement_type_enum;

  @ApiProperty({ description: 'Quantity moved' })
  @IsNumber()
  @IsNotEmpty()
  quantity: number;

  @ApiProperty({ description: 'Unit cost (optional)' })
  @IsNumber()
  @IsOptional()
  unit_cost?: number;

  @ApiProperty({ description: 'Reference number (optional)' })
  @IsString()
  @IsOptional()
  reference_number?: string;

  @ApiProperty({ description: 'Reason for movement' })
  @IsString()
  @IsNotEmpty()
  reason: string;

  @ApiProperty({ description: 'Notes (optional)' })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiProperty({ description: 'Batch number (optional)' })
  @IsString()
  @IsOptional()
  batch_number?: string;

  @ApiProperty({ description: 'Serial number (optional)' })
  @IsString()
  @IsOptional()
  serial_number?: string;

  @ApiProperty({ description: 'Expiration date (optional)' })
  @IsDateString()
  @IsOptional()
  expiration_date?: string;
}
