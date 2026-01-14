import { Module, Global } from '@nestjs/common';
import { DefaultPanelUIService } from './default-panel-ui.service';

/**
 * DefaultPanelUIModule
 *
 * Módulo global que proporciona el servicio centralizado de configuraciones
 * de panel UI para todos los módulos de la aplicación.
 *
 * @remarks
 * Este módulo está marcado como @Global para que el servicio esté
 * disponible en toda la aplicación sin necesidad de importarlo explícitamente
 * en cada módulo.
 */
@Global()
@Module({
  providers: [DefaultPanelUIService],
  exports: [DefaultPanelUIService],
})
export class DefaultPanelUIModule {}
