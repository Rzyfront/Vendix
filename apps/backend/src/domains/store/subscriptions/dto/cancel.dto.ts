import { IsOptional, IsString } from 'class-validator';

export class CancelDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
