import { IsArray, IsInt } from 'class-validator';

export class UpdateUserRolesDto {
  @IsArray()
  @IsInt({ each: true })
  role_ids: number[];
}
