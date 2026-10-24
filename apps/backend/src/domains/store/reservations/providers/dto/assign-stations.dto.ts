import { IsArray, IsInt } from 'class-validator';

export class AssignStationsDto {
  @IsArray({ message: 'station_ids debe ser un arreglo de identificadores' })
  @IsInt({ each: true, message: 'Cada ID de estación debe ser un número entero' })
  station_ids!: number[];
}
