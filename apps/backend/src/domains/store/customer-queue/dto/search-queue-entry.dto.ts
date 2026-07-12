import { IsString, IsNotEmpty, MinLength } from 'class-validator';

export class SearchQueueEntryDto {
  @IsString()
  @IsNotEmpty()
  document_type: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(5, { message: 'Document number must be at least 5 characters' })
  document_number: string;
}
