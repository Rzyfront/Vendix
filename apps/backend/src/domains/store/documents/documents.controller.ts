import { Controller, Get, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { IndustryModuleGuard } from '../../../common/guards/industry-module.guard';
import { IndustryModule } from '../../../common/decorators/industry-module.decorator';
import { DossiersService } from './dossiers.service';
import { DossiersQueryDto } from './dto/dossiers-query.dto';

/** Expedientes de la tienda (lectura). La descarga vive en `DocumentFilesController`. */
@Controller('store/documents/dossiers')
@UseGuards(PermissionsGuard, IndustryModuleGuard)
@IndustryModule('documents')
export class DossiersController {
  constructor(
    private readonly dossiers: DossiersService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('store:documents:read')
  async list(@Query() query: DossiersQueryDto) {
    const r = await this.dossiers.list(query);
    return this.responseService.paginated(r.data, r.total, r.page, r.limit);
  }

  @Get(':id')
  @Permissions('store:documents:read')
  async get(@Param('id', ParseIntPipe) id: number) {
    return this.responseService.success(await this.dossiers.get(id));
  }
}
