import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsNumber,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCommentDto {
  @ApiProperty({ description: 'Ticket ID to comment on' })
  @IsNumber()
  @IsNotEmpty()
  @Type(() => Number)
  ticket_id: number;

  @ApiProperty({ description: 'Comment content' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  content: string;

  @ApiProperty({
    description: 'Whether this is an internal note (only visible to admins)',
    required: false,
  })
  @IsOptional()
  is_internal?: boolean;

  @ApiProperty({ description: 'Attachments (base64 encoded)', required: false })
  @IsOptional()
  attachments?: Array<{
    base64_data: string;
    file_name: string;
    mime_type: string;
  }>;
}
