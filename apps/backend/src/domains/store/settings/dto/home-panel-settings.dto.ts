import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import {
  HOME_PANEL_IDS,
  HomePanelId,
} from '../../../../common/access/home-panels';

/** `default_panel` must be one of `enabled_panels` (QUI-967). */
@ValidatorConstraint({ name: 'homePanelDefaultEnabled', async: false })
export class HomePanelDefaultEnabledConstraint
  implements ValidatorConstraintInterface
{
  validate(value: unknown, args: ValidationArguments): boolean {
    const dto = args.object as { enabled_panels?: unknown };
    if (!Array.isArray(dto.enabled_panels)) return true; // its own error
    return dto.enabled_panels.includes(value);
  }

  defaultMessage(): string {
    return 'El panel de inicio debe estar entre los paneles habilitados';
  }
}

/**
 * Espejo de `store_settings.settings.home_panel` (QUI-967): panel con el que
 * abre el Panel Principal de la tienda y paneles que aparecen como pestañas.
 * Se edita como un todo. Los ids pertenecen al catálogo cerrado
 * `HOME_PANEL_IDS`.
 */
export class HomePanelSettingsDto {
  @ApiProperty({ enum: HOME_PANEL_IDS, example: 'occupancy' })
  @IsIn(HOME_PANEL_IDS as unknown as string[], {
    message: 'default_panel no pertenece al catálogo de paneles',
  })
  @Validate(HomePanelDefaultEnabledConstraint)
  default_panel: HomePanelId;

  @ApiProperty({
    enum: HOME_PANEL_IDS,
    isArray: true,
    example: ['occupancy', 'summary', 'crm_pipeline'],
  })
  @IsArray({ message: 'enabled_panels debe ser una lista' })
  @ArrayMinSize(1, { message: 'Habilita al menos un panel' })
  @ArrayMaxSize(HOME_PANEL_IDS.length)
  @ArrayUnique({ message: 'enabled_panels no puede repetir paneles' })
  @IsIn(HOME_PANEL_IDS as unknown as string[], {
    each: true,
    message: 'enabled_panels contiene un panel fuera del catálogo',
  })
  enabled_panels: HomePanelId[];
}
