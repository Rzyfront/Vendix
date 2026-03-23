import { IsString, IsOptional } from 'class-validator';

export class ExportAchDto {
  @IsString()
  bank: string;

  @IsOptional()
  @IsString()
  source_account?: string;

  @IsOptional()
  @IsString()
  source_account_type?: string;
}
