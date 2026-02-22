import { IsNumber, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { TicketQueryDto } from '../../../support/tickets/dto/ticket-query.dto';

/**
 * Extended query DTO for superadmin support tickets
 * Adds organization and store filtering capabilities
 */
export class SuperadminTicketQueryDto extends TicketQueryDto {
  @ApiProperty({ description: 'Filter by organization ID', required: false })
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  organization_id?: number;

  @ApiProperty({ description: 'Filter by store ID', required: false })
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  store_id?: number;
}
