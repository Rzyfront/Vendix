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
  Req,
} from '@nestjs/common';
import { OrgTaxesService } from './taxes.service';
import {
  CreateTaxCategoryDto,
  UpdateTaxCategoryDto,
  TaxCategoryQueryDto,
  SeedDefaultTaxesDto,
} from '../../store/taxes/dto';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { AuthenticatedRequest } from '@common/interfaces/authenticated-request.interface';
import { ResponseService } from '@common/responses/response.service';
import { DefaultTaxesSeederService } from '@common/services/default-taxes-seeder.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '@common/errors';

@Controller('organization/taxes')
@UseGuards(PermissionsGuard)
export class OrgTaxesController {
  constructor(
    private readonly taxesService: OrgTaxesService,
    private readonly responseService: ResponseService,
    private readonly defaultTaxesSeeder: DefaultTaxesSeederService,
  ) {}

  @Post('seed-default')
  @Permissions('organization:taxes:create')
  @HttpCode(HttpStatus.CREATED)
  async seedDefault(@Body() body: SeedDefaultTaxesDto) {
    const organization_id = RequestContextService.getOrganizationId();
    if (!organization_id) {
      throw new VendixHttpException(
        ErrorCodes.STORE_CONTEXT_001,
        'Organization context required to seed default taxes.',
      );
    }
    const result = await this.defaultTaxesSeeder.seed({
      scope: 'ORGANIZATION',
      organization_id,
      force: body.force,
    });
    return this.responseService.created(
      result,
      'Default Colombian taxes seeded for organization successfully',
    );
  }

  @Post()
  @Permissions('organization:taxes:create')
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
  @Permissions('organization:taxes:read')
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
  @Permissions('organization:taxes:read')
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
  @Permissions('organization:taxes:update')
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
  @Permissions('organization:taxes:delete')
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
