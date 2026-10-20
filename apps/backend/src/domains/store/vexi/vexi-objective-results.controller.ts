import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ResponseService } from '../../../common/responses/response.service';
import { AgentObjectiveResultsQueryDto } from './dto/resume-agent-objective.dto';
import { VexiSurfaceEnabledGuard } from './guards/vexi-surface-enabled.guard';
import { VexiPlanStateService } from './vexi-plan-state.service';

/**
 * Lectores de los artefactos que el propio turno de Vexi guardó.
 *
 * Viven fuera de `VexiController` a propósito: esa clase exige OWNER/ADMIN con
 * `@Roles` de clase, y `RolesGuard` resuelve con `getAllAndOverride`, así que
 * ningún handler de ahí adentro puede relajarlo (un `@Roles()` vacío da 403 y
 * los roles personalizados, como `cashier`, no están en el enum). Pero el
 * chat de Vexi lo usa cualquier usuario de la tienda, y la compactación de
 * resultados grandes le dice al modelo que relea el resultado completo por
 * estas rutas con `call_endpoint`. Con el candado de rol, un cajero recibía
 * 403 al leer el artefacto de SU propio objetivo: el puente lo marcaba
 * `blocked`, el turno terminaba agotado y aparecía un aviso falso de permisos
 * (E2E g14).
 *
 * La autorización no se pierde, se mueve a donde corresponde: el repositorio de
 * objetivos (`getResult` / `listResults`) filtra por tienda, organización,
 * usuario y objetivo del contexto ALS antes de devolver nada, así que solo se
 * lee lo que el mismo usuario produjo. Son solo lectura: no escriben ni gastan
 * proveedor, por eso tampoco llevan el gate de suscripción de IA. Se conserva
 * el interruptor de la superficie Vexi de la tienda.
 */
@Controller('store/vexi')
@UseGuards(VexiSurfaceEnabledGuard)
export class VexiObjectiveResultsController {
  constructor(
    private readonly responseService: ResponseService,
    private readonly planState: VexiPlanStateService,
  ) {}

  @Get('objectives/:id/results')
  async getObjectiveResults(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: AgentObjectiveResultsQueryDto,
  ) {
    return this.responseService.success(
      await this.planState.listObjectiveResults(id, query),
      'Resultados del objetivo',
    );
  }

  @Get('objectives/:id/results/:resultId')
  async getObjectiveResult(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('resultId', ParseUUIDPipe) resultId: string,
    @Query() query: AgentObjectiveResultsQueryDto,
  ) {
    return this.responseService.success(
      await this.planState.getObjectiveArtifact(id, resultId, query),
      'Resultado observado del objetivo',
    );
  }
}
