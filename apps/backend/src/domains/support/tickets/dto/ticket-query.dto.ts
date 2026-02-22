import {
  IsOptional,
  IsNumber,
  IsString,
  IsEnum,
  IsDateString,
  Min,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ticket_status_enum,
  ticket_priority_enum,
  ticket_category_enum,
} from '@prisma/client';

export class TicketQueryDto {
  @ApiProperty({ description: 'Filter by status', enum: ticket_status_enum, required: false })
  @IsEnum(ticket_status_enum)
  @IsOptional()
  status?: ticket_status_enum;

  @ApiProperty({ description: 'Filter by priority', enum: ticket_priority_enum, required: false })
  @IsEnum(ticket_priority_enum)
  @IsOptional()
  priority?: ticket_priority_enum;

  @ApiProperty({ description: 'Filter by category', enum: ticket_category_enum, required: false })
  @IsEnum(ticket_category_enum)
  @IsOptional()
  category?: ticket_category_enum;

  @ApiProperty({ description: 'Filter by assigned user ID', required: false })
  @IsNumber()
  @IsOptional()
  assigned_to_user_id?: number;

  @ApiProperty({ description: 'Filter by customer ID', required: false })
  @IsNumber()
  @IsOptional()
  customer_id?: number;

  @ApiProperty({ description: 'Search in title and description', required: false })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiProperty({ description: 'Filter by tag', required: false })
  @IsString()
  @IsOptional()
  tag?: string;

  @ApiProperty({ description: 'Filter by date from (ISO date)', required: false })
  @IsDateString()
  @IsOptional()
  date_from?: string;

  @ApiProperty({ description: 'Filter by date to (ISO date)', required: false })
  @IsDateString()
  @IsOptional()
  date_to?: string;

  @ApiProperty({ description: 'Page number', required: false, default: 1 })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @IsOptional()
  page?: number;

  @ApiProperty({ description: 'Items per page', required: false, default: 10 })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @IsOptional()
  limit?: number;
}
