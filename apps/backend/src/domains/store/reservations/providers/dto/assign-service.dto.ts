import { IsInt } from 'class-validator';

export class AssignServiceDto {
  @IsInt()
  product_id: number;
}
