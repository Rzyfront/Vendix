import { IsOptional, IsString, IsBoolean } from 'class-validator';

export class CancelDto {
  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsBoolean()
  end_of_cycle?: boolean;
}
