import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { TaxesService } from './taxes.service';
import {
  CreateTaxCategoryDto,
  UpdateTaxCategoryDto,
  TaxCategoryQueryDto,
  SeedDefaultTaxesDto,
} from './dto';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { Req } from '@nestjs/common';
import { AuthenticatedRequest } from '@common/interfaces/authenticated-request.interface';
import { ResponseService } from '@common/responses/response.service';
import { DefaultTaxesSeederService } from '@common/services/default-taxes-seeder.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '@common/errors';
import { FiscalScopeService } from '@common/services/fiscal-scope.service';

@Controller('store/taxes')
@UseGuards(PermissionsGuard)
export class TaxesController {
  constructor(
    private readonly taxesService: TaxesService,
    private readonly responseService: ResponseService,
    private readonly defaultTaxesSeeder: DefaultTaxesSeederService,
    private readonly fiscalScope: FiscalScopeService,
  ) {}

  @Post('seed-default')
  @Permissions('store:taxes:create')
  @HttpCode(HttpStatus.CREATED)
  async seedDefault(@Body() body: SeedDefaultTaxesDto) {
    const store_id = RequestContextService.getStoreId();
    if (!store_id) {
      throw new VendixHttpException(
        ErrorCodes.STORE_CONTEXT_001,
        'Store context required to seed default taxes.',
      );
    }
    const organization_id = RequestContextService.getOrganizationId();
    if (organization_id) {
      const fiscalScope =
        await this.fiscalScope.requireFiscalScope(organization_id);
      if (fiscalScope === 'ORGANIZATION') {
        throw new BadRequestException(
          'Taxes are managed at organization level for this organization.',
        );
      }
    }
    const result = await this.defaultTaxesSeeder.seed({
      scope: 'STORE',
      store_id,
      organization_id,
      force: body.force,
    });
    return this.responseService.created(
      result,
      'Default Colombian taxes seeded successfully',
    );
  }

  @Post()
  @Permissions('store:taxes:create')
  async create(
    @Body() createTaxCategoryDto: CreateTaxCategoryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      const tax = await this.taxesService.create(
        createTaxCategoryDto,
        req.user,
      );
      return this.responseService.created(
        tax,
        'Categoría de impuesto creada exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        'Error al crear categoría de impuesto',
        error.message,
      );
    }
  }

  @Get()
  @Permissions('store:taxes:read')
  async findAll(@Query() query: TaxCategoryQueryDto) {
    try {
      const result = await this.taxesService.findAll(query);

      if (result.data && result.meta) {
        return this.responseService.paginated(
          result.data,
          result.meta.total,
          result.meta.page,
          result.meta.limit,
          'Categorías de impuestos obtenidas exitosamente',
        );
      } else {
        return this.responseService.success(
          result,
          'Categorías de impuestos obtenidas exitosamente',
        );
      }
    } catch (error) {
      return this.responseService.error(
        'Error al obtener categorías de impuestos',
        error.message,
      );
    }
  }

  @Get(':id')
  @Permissions('store:taxes:read')
  async findOne(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      const tax = await this.taxesService.findOne(id, req.user);
      return this.responseService.success(
        tax,
        'Categoría de impuesto obtenida exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        'Error al obtener categoría de impuesto',
        error.message,
      );
    }
  }

  @Patch(':id')
  @Permissions('store:taxes:update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateTaxCategoryDto: UpdateTaxCategoryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      const tax = await this.taxesService.update(
        id,
        updateTaxCategoryDto,
        req.user,
      );
      return this.responseService.updated(
        tax,
        'Categoría de impuesto actualizada exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        'Error al actualizar categoría de impuesto',
        error.message,
      );
    }
  }

  @Delete(':id')
  @Permissions('store:taxes:delete')
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      await this.taxesService.remove(id, req.user);
      return this.responseService.deleted(
        'Categoría de impuesto eliminada exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        'Error al eliminar categoría de impuesto',
        error.message,
      );
    }
  }
}
