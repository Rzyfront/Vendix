import { Controller, Get, Query, UseGuards } from '@nestjs/common';
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

  /**
   * Catálogo global de unidades. `?dimension=` acota a una dimensión —el editor
   * solo ofrece unidades convertibles entre sí— y `?stock_eligible=true` deja
   * fuera las que no pueden ser unidad de stock por tener factor no entero
   * (pulgada, galón), que sí sirven como unidad de compra o presentación.
   */
  @Get()
  @Permissions('store:inventory:inventory:read')
  async findAll(
    @Query('dimension') dimension?: string,
    @Query('stock_eligible') stockEligible?: string,
  ) {
    const allowedDimensions = ['mass', 'volume', 'length', 'count'];
    const rows = await this.prisma.units_of_measure.findMany({
      where: {
        is_active: true,
        ...(dimension && allowedDimensions.includes(dimension)
          ? { dimension: dimension as any }
          : {}),
        ...(stockEligible === 'true' ? { is_stock_eligible: true } : {}),
      },
      orderBy: [
        { dimension: 'asc' },
        { is_base: 'desc' },
        { factor_to_base: 'asc' },
      ],
    });
    return this.responseService.success(
      rows,
      'Unidades de medida obtenidas exitosamente',
    );
  }
}
