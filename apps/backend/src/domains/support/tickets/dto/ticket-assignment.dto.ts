import { IsNumber, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AssignTicketDto {
  @ApiProperty({ description: 'User ID to assign the ticket to' })
  @IsNumber()
  @IsNotEmpty()
  assigned_to_user_id: number;

  @ApiProperty({ description: 'Assignment notes', required: false })
  @IsString()
  @IsOptional()
  notes?: string;
}
