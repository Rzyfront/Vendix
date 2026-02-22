import { IsNotEmpty, IsString, IsOptional, ValidateIf } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCommentDto {
  @ApiProperty({ description: 'Comment content' })
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiProperty({
    description: 'Whether this is an internal note (only visible to admins)',
    required: false
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
