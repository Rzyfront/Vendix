import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  ParseIntPipe,
  UseGuards,
  Request,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import {
  CreateOrganizationDto,
  UpdateOrganizationDto,
  OrganizationQueryDto,
} from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { ResponseService } from '../../common/responses/response.service';

@Controller('organizations')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class OrganizationsController {
  constructor(
    private readonly organizationsService: OrganizationsService,
    private readonly responseService: ResponseService,
  ) {}

  @Post()
  @Permissions('organizations:create')
  async create(@Body() createOrganizationDto: CreateOrganizationDto, @Request() req) {
    try {
      const result = await this.organizationsService.create(createOrganizationDto);
      return this.responseService.created(
        result,
        'Organización creada exitosamente',
        req.url,
      );
    } catch (error) {
      throw this.responseService.internalServerError(
        'Error al crear la organización',
        error.message,
        req.url,
      );
    }
  }

  @Get()
  @Permissions('organizations:read')
  async findAll(@Query() query: OrganizationQueryDto, @Request() req) {
    try {
      const result = await this.organizationsService.findAll(query);
      return this.responseService.paginated(
        result.data,
        result.meta,
        'Organizaciones obtenidas exitosamente',
        req.url,
      );
    } catch (error) {
      throw this.responseService.internalServerError(
        'Error al obtener las organizaciones',
        error.message,
        req.url,
      );
    }
  }

  @Get(':id')
  @Permissions('organizations:read')
  async findOne(@Param('id', ParseIntPipe) id: number, @Request() req) {
    try {
      const result = await this.organizationsService.findOne(id);
      return this.responseService.success(
        result,
        'Organización obtenida exitosamente',
        req.url,
      );
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw this.responseService.notFound(
          'Organización no encontrada',
          error.message,
          req.url,
        );
      }
      throw this.responseService.internalServerError(
        'Error al obtener la organización',
        error.message,
        req.url,
      );
    }
  }

  @Get('slug/:slug')
  @Permissions('organizations:read')
  async findBySlug(@Param('slug') slug: string, @Request() req) {
    try {
      const result = await this.organizationsService.findBySlug(slug);
      return this.responseService.success(
        result,
        'Organización obtenida exitosamente',
        req.url,
      );
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw this.responseService.notFound(
          'Organización no encontrada',
          error.message,
          req.url,
        );
      }
      throw this.responseService.internalServerError(
        'Error al obtener la organización',
        error.message,
        req.url,
      );
    }
  }

  @Patch(':id')
  @Permissions('organizations:update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateOrganizationDto: UpdateOrganizationDto,
    @Request() req
  ) {
    try {
      const result = await this.organizationsService.update(id, updateOrganizationDto);
      return this.responseService.success(
        result,
        'Organización actualizada exitosamente',
        req.url,
      );
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw this.responseService.notFound(
          'Organización no encontrada',
          error.message,
          req.url,
        );
      }
      if (error instanceof ConflictException) {
        throw this.responseService.conflict(
          'Ya existe una organización con este nombre o slug',
          error.message,
          req.url,
        );
      }
      if (error instanceof BadRequestException) {
        throw this.responseService.badRequest(
          'Datos inválidos',
          error.message,
          req.url,
        );
      }
      throw this.responseService.internalServerError(
        'Error al actualizar la organización',
        error.message,
        req.url,
      );
    }
  }

  @Delete(':id')
  @Permissions('organizations:delete')
  async remove(@Param('id', ParseIntPipe) id: number, @Request() req) {
    try {
      const result = await this.organizationsService.remove(id);
      return this.responseService.success(
        result,
        'Organización eliminada exitosamente',
        req.url,
      );
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw this.responseService.notFound(
          'Organización no encontrada',
          error.message,
          req.url,
        );
      }
      if (error instanceof BadRequestException) {
        throw this.responseService.badRequest(
          'No se puede eliminar la organización',
          error.message,
          req.url,
        );
      }
      throw this.responseService.internalServerError(
        'Error al eliminar la organización',
        error.message,
        req.url,
      );
    }
  }
}