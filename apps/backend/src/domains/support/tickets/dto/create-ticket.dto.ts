import {
  IsNotEmpty,
  IsString,
  IsNumber,
  IsEnum,
  IsOptional,
  IsArray,
  ValidateNested,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import {
  ticket_priority_enum,
  ticket_category_enum,
} from '@prisma/client';

export class TicketAttachmentDto {
  @ApiProperty({ description: 'Base64 encoded image' })
  @IsString()
  @IsNotEmpty()
  base64_data: string;

  @ApiProperty({ description: 'File name' })
  @IsString()
  @IsNotEmpty()
  file_name: string;

  @ApiProperty({ description: 'File type' })
  @IsString()
  @IsNotEmpty()
  mime_type: string;

  @ApiProperty({ description: 'Description (optional)' })
  @IsString()
  @IsOptional()
  description?: string;
}

export class CreateTicketDto {
  @ApiProperty({ description: 'Ticket title' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  @ApiProperty({ description: 'Detailed description' })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiProperty({
    description: 'Ticket category',
    enum: ticket_category_enum,
    required: false,
  })
  @IsEnum(ticket_category_enum)
  @IsOptional()
  category?: ticket_category_enum;

  @ApiProperty({
    description: 'Ticket priority',
    enum: ticket_priority_enum,
    required: false,
  })
  @IsEnum(ticket_priority_enum)
  @IsOptional()
  priority?: ticket_priority_enum;

  @ApiProperty({ description: 'Related order ID (optional)' })
  @IsNumber()
  @IsOptional()
  related_order_id?: number;

  @ApiProperty({ description: 'Related order type (optional)' })
  @IsString()
  @IsOptional()
  related_order_type?: string;

  @ApiProperty({ description: 'Related product ID (optional)' })
  @IsNumber()
  @IsOptional()
  related_product_id?: number;

  @ApiProperty({
    description: 'Attachments',
    type: [TicketAttachmentDto],
    required: false,
  })
  @ValidateNested({ each: true })
  @Type(() => TicketAttachmentDto)
  @IsOptional()
  attachments?: TicketAttachmentDto[];

  @ApiProperty({ description: 'Tags', required: false })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];
}
