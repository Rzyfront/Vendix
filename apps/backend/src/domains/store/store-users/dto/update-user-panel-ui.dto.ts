import { IsObject } from 'class-validator';
import { PanelUiKeysWhitelist } from '../../../../common/utils/panel-ui.util';

export class UpdateUserPanelUIDto {
  @IsObject()
  @PanelUiKeysWhitelist()
  panel_ui: Record<string, Record<string, boolean>>;
}
