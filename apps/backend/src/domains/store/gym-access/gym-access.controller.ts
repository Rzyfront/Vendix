import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ResponseService } from '@common/responses/response.service';
import { GymAccessService } from './gym-access.service';
import {
  ValidateAccessDto,
  CreateCredentialDto,
  UpdateCredentialDto,
  CredentialQueryDto,
  AccessLogQueryDto,
} from './dto';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';

/**
 * Store-scoped gym access control (Gym Suite — Ola 1).
 *
 * Permission policy:
 *   - POST /validate           → store:gym_access:create (writes an access log)
 *   - GET  /logs               → store:gym_access:read
 *   - GET  /credentials        → store:gym_access:read
 *   - POST /credentials        → store:gym_access:create
 *   - PATCH /credentials/:id   → store:gym_access:update
 *   - DELETE /credentials/:id  → store:gym_access:update (soft baja)
 */
@Controller('store/gym/access')
@UseGuards(PermissionsGuard)
export class GymAccessController {
  constructor(
    private readonly service: GymAccessService,
    private readonly responseService: ResponseService,
  ) {}

  private fail(error: any, fallback: string) {
    return this.responseService.error(
      error.response?.message || error.message || fallback,
      error.response?.message || error.message,
      error.getStatus?.() ?? error.status ?? 400,
      error.errorCode,
    );
  }

  @Post('validate')
  @Permissions('store:gym_access:create')
  async validate(@Body() dto: ValidateAccessDto) {
    try {
      const result = await this.service.validate(dto);
      return this.responseService.success(result, 'Validación de acceso');
    } catch (error: any) {
      return this.fail(error, 'Error al validar el acceso');
    }
  }

  @Get('logs')
  @Permissions('store:gym_access:read')
  async listLogs(@Query() query: AccessLogQueryDto) {
    try {
      const result = await this.service.listLogs(query);
      return this.responseService.paginated(
        result.data,
        result.meta.total,
        result.meta.page,
        result.meta.limit,
        'Bitácora de accesos obtenida exitosamente',
      );
    } catch (error: any) {
      return this.fail(error, 'Error al obtener la bitácora de accesos');
    }
  }

  @Get('credentials')
  @Permissions('store:gym_access:read')
  async listCredentials(@Query() query: CredentialQueryDto) {
    try {
      const result = await this.service.listCredentials(query);
      return this.responseService.paginated(
        result.data,
        result.meta.total,
        result.meta.page,
        result.meta.limit,
        'Credenciales obtenidas exitosamente',
      );
    } catch (error: any) {
      return this.fail(error, 'Error al obtener las credenciales');
    }
  }

  @Post('credentials')
  @Permissions('store:gym_access:create')
  async createCredential(@Body() dto: CreateCredentialDto) {
    try {
      const result = await this.service.createCredential(dto);
      return this.responseService.created(
        result,
        'Credencial creada exitosamente',
      );
    } catch (error: any) {
      return this.fail(error, 'Error al crear la credencial');
    }
  }

  @Patch('credentials/:id')
  @Permissions('store:gym_access:update')
  async updateCredential(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCredentialDto,
  ) {
    try {
      const result = await this.service.updateCredential(id, dto);
      return this.responseService.updated(
        result,
        'Credencial actualizada exitosamente',
      );
    } catch (error: any) {
      return this.fail(error, 'Error al actualizar la credencial');
    }
  }

  @Delete('credentials/:id')
  @Permissions('store:gym_access:update')
  async deactivateCredential(@Param('id', ParseIntPipe) id: number) {
    try {
      const result = await this.service.deactivateCredential(id);
      return this.responseService.success(
        result,
        'Credencial dada de baja exitosamente',
      );
    } catch (error: any) {
      return this.fail(error, 'Error al dar de baja la credencial');
    }
  }
}
