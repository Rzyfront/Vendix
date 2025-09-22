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
  HttpStatus,
  HttpCode,
  Request,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { AddressesService } from './addresses.service';
import {
  CreateAddressDto,
  UpdateAddressDto,
  AddressQueryDto,
} from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ResponseService } from '../../common/responses/response.service';

@Controller('addresses')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AddressesController {
  constructor(
    private readonly addressesService: AddressesService,
    private readonly responseService: ResponseService,
  ) {}

  @Post()
  @Permissions('addresses:create')
  async create(
    @Body() createAddressDto: CreateAddressDto,
    @CurrentUser() user: any,
    @Request() req,
  ) {
    try {
      const result = await this.addressesService.create(createAddressDto, user);
      return this.responseService.created(
        result,
        'Dirección creada exitosamente',
        req.url,
      );
    } catch (error) {
      if (error instanceof ConflictException) {
        throw this.responseService.conflict(
          'Ya existe una dirección con estos datos',
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
      if (error instanceof ForbiddenException) {
        throw this.responseService.forbidden(
          'No tienes permisos para crear esta dirección',
          error.message,
          req.url,
        );
      }
      throw this.responseService.internalServerError(
        'Error al crear la dirección',
        error.message,
        req.url,
      );
    }
  }

  @Get()
  @Permissions('addresses:read')
  async findAll(@Query() query: AddressQueryDto, @CurrentUser() user: any, @Request() req) {
    try {
      const result = await this.addressesService.findAll(query, user);
      return this.responseService.success(
        result,
        'Direcciones obtenidas exitosamente',
        req.url,
      );
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw this.responseService.forbidden(
          'No tienes permisos para ver estas direcciones',
          error.message,
          req.url,
        );
      }
      throw this.responseService.internalServerError(
        'Error al obtener las direcciones',
        error.message,
        req.url,
      );
    }
  }

  @Get('store/:storeId')
  @Permissions('addresses:read')
  async findByStore(
    @Param('storeId', ParseIntPipe) storeId: number,
    @CurrentUser() user: any,
    @Request() req,
  ) {
    try {
      const result = await this.addressesService.findByStore(storeId, user);
      return this.responseService.success(
        result,
        'Direcciones obtenidas exitosamente',
        req.url,
      );
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw this.responseService.forbidden(
          'No tienes permisos para ver estas direcciones',
          error.message,
          req.url,
        );
      }
      if (error instanceof NotFoundException) {
        throw this.responseService.notFound(
          'Tienda no encontrada',
          error.message,
          req.url,
        );
      }
      throw this.responseService.internalServerError(
        'Error al obtener las direcciones',
        error.message,
        req.url,
      );
    }
  }

  @Get(':id')
  @Permissions('addresses:read')
  async findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: any,
    @Request() req,
  ) {
    try {
      const result = await this.addressesService.findOne(id, user);
      return this.responseService.success(
        result,
        'Dirección obtenida exitosamente',
        req.url,
      );
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw this.responseService.notFound(
          'Dirección no encontrada',
          error.message,
          req.url,
        );
      }
      if (error instanceof ForbiddenException) {
        throw this.responseService.forbidden(
          'No tienes permisos para ver esta dirección',
          error.message,
          req.url,
        );
      }
      throw this.responseService.internalServerError(
        'Error al obtener la dirección',
        error.message,
        req.url,
      );
    }
  }

  @Patch(':id')
  @Permissions('addresses:update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateAddressDto: UpdateAddressDto,
    @CurrentUser() user: any,
    @Request() req,
  ) {
    try {
      const result = await this.addressesService.update(id, updateAddressDto, user);
      return this.responseService.success(
        result,
        'Dirección actualizada exitosamente',
        req.url,
      );
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw this.responseService.notFound(
          'Dirección no encontrada',
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
      if (error instanceof ForbiddenException) {
        throw this.responseService.forbidden(
          'No tienes permisos para actualizar esta dirección',
          error.message,
          req.url,
        );
      }
      throw this.responseService.internalServerError(
        'Error al actualizar la dirección',
        error.message,
        req.url,
      );
    }
  }

  @Delete(':id')
  @Permissions('addresses:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: any,
    @Request() req,
  ) {
    try {
      const result = await this.addressesService.remove(id, user);
      return this.responseService.deleted(
        'Dirección eliminada exitosamente',
        req.url,
      );
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw this.responseService.notFound(
          'Dirección no encontrada',
          error.message,
          req.url,
        );
      }
      if (error instanceof BadRequestException) {
        throw this.responseService.badRequest(
          'No se puede eliminar la dirección',
          error.message,
          req.url,
        );
      }
      if (error instanceof ForbiddenException) {
        throw this.responseService.forbidden(
          'No tienes permisos para eliminar esta dirección',
          error.message,
          req.url,
        );
      }
      throw this.responseService.internalServerError(
        'Error al eliminar la dirección',
        error.message,
        req.url,
      );
    }
  }
}