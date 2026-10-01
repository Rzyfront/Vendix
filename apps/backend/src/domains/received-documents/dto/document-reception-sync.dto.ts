import { Type } from 'class-transformer';
import { IsInt, IsUUID, Min } from 'class-validator';

export class ManualDocumentReceptionSyncDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expected_version!: number;

  @IsUUID('4')
  idempotency_key!: string;
}
