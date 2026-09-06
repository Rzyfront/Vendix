import {
  Controller,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ContractsService } from './contracts.service';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { ConstructionIndustryGuard } from '../../../common/guards/construction-industry.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';

/**
 * C.1 (FB-06) — `POST /store/contracts/from-quotation/:id` crea la ficha
 * del contrato desde la cotizacion aceptada. El gating por industria
 * (A.2, ERR-03) es frontera real: sin `construction` responde 403 aunque
 * se invoque por fuera del menu. Los permisos `store:contracts:*` ya
 * existen en el seed (A.2); GET/PATCH de la ficha los posee C.2.
 */
@Controller('store/contracts')
@UseGuards(PermissionsGuard, ConstructionIndustryGuard)
export class ContractsController {
  constructor(
    private readonly contractsService: ContractsService,
    private readonly responseService: ResponseService,
  ) {}

  @Post('from-quotation/:id')
  @Permissions('store:contracts:create')
  async createFromQuotation(@Param('id', ParseIntPipe) id: number) {
    const result = await this.contractsService.createFromQuotation(id);
    return this.responseService.created(
      result,
      'Contrato creado exitosamente',
    );
  }
}
