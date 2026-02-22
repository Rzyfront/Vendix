import { PartialType } from '@nestjs/swagger';
import { IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ticket_status_enum } from '@prisma/client';
import { CreateTicketDto } from './create-ticket.dto';

export class UpdateTicketDto extends PartialType(CreateTicketDto) {
  @ApiProperty({
    description: 'Ticket status',
    enum: ticket_status_enum,
    required: false,
  })
  @IsEnum(ticket_status_enum)
  @IsOptional()
  status?: ticket_status_enum;

  @ApiProperty({ description: 'Assigned user ID', required: false })
  @IsNumber()
  @IsOptional()
  assigned_to_user_id?: number;

  @ApiProperty({ description: 'Resolution summary', required: false })
  @IsString()
  @IsOptional()
  resolution_summary?: string;

  @ApiProperty({ description: 'Customer satisfaction (true/false)', required: false })
  @IsOptional()
  customer_satisfied?: boolean;
}
