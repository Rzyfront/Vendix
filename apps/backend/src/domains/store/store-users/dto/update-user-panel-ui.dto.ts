import { IsObject } from 'class-validator';

export class UpdateUserPanelUIDto {
  @IsObject()
  panel_ui: Record<string, Record<string, boolean>>;
}
