import { IsIn, IsInt, IsString, Length, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class DecideServiceProposalDto {
  @IsIn(['approved', 'rejected'])
  decision: 'approved' | 'rejected';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  proposal_version: number;

  @IsString()
  @Length(64, 64)
  snapshot_hash: string;
}
