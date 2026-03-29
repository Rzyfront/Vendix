import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateConversationDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  app_key?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;
}
