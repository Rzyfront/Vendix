import { IsArray, IsInt, IsOptional, IsObject, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PanelUiKeysWhitelist } from '../../../../common/utils/panel-ui.util';

export class UserConfigDto {
  @ApiProperty({
    enum: [
      'ORG_ADMIN',
      'STORE_ADMIN',
      'STORE_ECOMMERCE',
      'STORE_DELIVERY',
      'VENDIX_LANDING',
    ],
    description: 'Application assigned to the user',
  })
  @IsIn([
    'ORG_ADMIN',
    'STORE_ADMIN',
    'STORE_ECOMMERCE',
    'STORE_DELIVERY',
    'VENDIX_LANDING',
  ])
  app:
    | 'ORG_ADMIN'
    | 'STORE_ADMIN'
    | 'STORE_ECOMMERCE'
    | 'STORE_DELIVERY'
    | 'VENDIX_LANDING';

  @ApiPropertyOptional({
    type: [Number],
    description: 'IDs of roles assigned to the user',
  })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  roles?: number[];

  @ApiPropertyOptional({
    type: [Number],
    description: 'IDs of stores assigned to the user',
  })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  store_ids?: number[];

  @ApiPropertyOptional({
    type: Object,
    description:
      'UI configuration for the panel. Shape canónica anidada por app_type: ' +
      '{ STORE_ADMIN: { pos: true }, ORG_ADMIN: { dashboard: false } }. ' +
      'Claves fuera del catálogo PANEL_UI_FALLBACK se rechazan (422).',
  })
  @IsOptional()
  @IsObject()
  @PanelUiKeysWhitelist()
  panel_ui?: Record<string, Record<string, boolean>>;
}
