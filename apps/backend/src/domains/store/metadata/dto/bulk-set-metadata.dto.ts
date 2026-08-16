import { IsArray, IsInt, ValidateNested, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { SetMetadataValueDto } from './set-metadata-value.dto';

export class BulkSetMetadataDto {
  @IsIn(['customer', 'booking', 'order'])
  entity_type: string;

  @IsInt()
  entity_id: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SetMetadataValueDto)
  values: SetMetadataValueDto[];
}
