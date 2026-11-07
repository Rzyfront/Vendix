import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsString, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

/** "Leer con IA": the request that owns the file and the form fields to fill. */
export class ReadDocumentCheckDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  instance_id!: number;

  /** Keys of the current stage's form fields; validated against the definition. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  field_keys!: string[];
}
