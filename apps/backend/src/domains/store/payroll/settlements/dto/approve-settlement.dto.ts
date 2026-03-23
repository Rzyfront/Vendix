import { IsOptional, IsString } from 'class-validator';

export class ApproveSettlementDto {
  @IsOptional()
  @IsString()
  notes?: string;
}
