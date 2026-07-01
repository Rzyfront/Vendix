import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ticket_status_enum } from '@prisma/client';

export class UpdatePqrStatusDto {
  @IsEnum(ticket_status_enum)
  status!: ticket_status_enum;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  change_reason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  resolution_summary?: string;
}