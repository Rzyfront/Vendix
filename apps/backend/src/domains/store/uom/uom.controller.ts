import { Controller, Get, UseGuards } from '@nestjs/common';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';

@Controller('store/uom')
@UseGuards(PermissionsGuard)
export class UomController {
  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('store:inventory:inventory:read')
  async findAll() {
    const rows = await this.prisma.units_of_measure.findMany({
      where: { is_active: true },
      orderBy: [{ dimension: 'asc' }, { is_base: 'desc' }, { name: 'asc' }],
    });
    return this.responseService.success(
      rows,
      'Unidades de medida obtenidas exitosamente',
    );
  }
}
