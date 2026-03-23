import { IsOptional, IsArray, IsInt, IsString, IsIn } from 'class-validator';

export class SyncPanelUiDto {
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  user_ids?: number[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  app_types?: string[];

  @IsOptional()
  @IsIn(['merge', 'replace'])
  strategy?: 'merge' | 'replace';
}
