import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ApprovePayoutDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  payout_method?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  reference?: string;
}
