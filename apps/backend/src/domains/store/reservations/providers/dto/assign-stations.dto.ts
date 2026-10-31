import { ArrayMaxSize, ArrayUnique, IsArray, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class AssignStationsDto {
  @IsArray({ message: 'station_ids debe ser un arreglo de identificadores' })
  @ArrayUnique({ message: 'station_ids no admite duplicados' })
  @ArrayMaxSize(200)
  @Type(() => Number)
  @IsInt({ each: true, message: 'Cada ID de estación debe ser un número entero' })
  @Min(1, { each: true })
  station_ids!: number[];
}
