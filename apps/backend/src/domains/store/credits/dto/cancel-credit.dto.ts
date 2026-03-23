import { IsOptional, IsString } from 'class-validator';

export class CancelCreditDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
