import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ticket_status_enum } from '@prisma/client';

export class UpdateTicketStatusDto {
  @ApiProperty({
    description: 'New ticket status',
    enum: ticket_status_enum,
  })
  @IsEnum(ticket_status_enum)
  @IsNotEmpty()
  status: ticket_status_enum;

  @ApiProperty({ description: 'Reason for status change', required: false })
  @IsString()
  @IsOptional()
  reason?: string;

  @ApiProperty({ description: 'Additional notes', required: false })
  @IsString()
  @IsOptional()
  notes?: string;
}

export class CloseTicketDto {
  @ApiProperty({ description: 'Resolution summary', required: false })
  @IsString()
  @IsOptional()
  resolution_summary?: string;

  @ApiProperty({ description: 'Customer satisfaction (true/false)', required: false })
  @IsOptional()
  customer_satisfied?: boolean;
}
