import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

/** Operational store selector for organization surfaces; never tenant identity. */
export class ReceivedDocumentContextQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  store_id?: number;
}
