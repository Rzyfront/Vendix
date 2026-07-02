import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ResponseService } from '@common/responses/response.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { MembershipAccessService } from './membership-access.service';
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
 * Store-scoped membership access control (generalized membership core).
 *
 * Permission policy:
 *   - POST /validate           → store:membership_access:create (writes an access log)
 *   - GET  /logs               → store:membership_access:read
 *   - GET  /credentials        → store:membership_access:read
 *   - POST /credentials        → store:membership_access:create
 *   - PATCH /credentials/:id   → store:membership_access:update
 *   - DELETE /credentials/:id  → store:membership_access:update (soft baja)
 */
@Controller('store/memberships/access')
@UseGuards(PermissionsGuard)
export class MembershipAccessController {
  constructor(
    private readonly service: MembershipAccessService,
    private readonly responseService: ResponseService,
  ) {}

  /**
   * Fix H1: throw instead of returning `responseService.error(...)` (which
   * emitted HTTP 2xx with an error body the frontend read as success). Typed
   * exceptions from the service are rethrown verbatim; opaque errors are
   * wrapped in a VendixHttpException with an existing code.
   */
  private fail(error: any, fallback: string): never {
    if (error instanceof VendixHttpException || error instanceof HttpException) {
      throw error;
    }
    throw new VendixHttpException(
      ErrorCodes.SYS_CONFLICT_001,
      error?.message || fallback,
    );
  }

  @Post('validate')
  @Permissions('store:membership_access:create')
  async validate(@Body() dto: ValidateAccessDto) {
    try {
      const result = await this.service.validate(dto);
      return this.responseService.success(result, 'Validación de acceso');
    } catch (error: any) {
      return this.fail(error, 'Error al validar el acceso');
    }
  }

  @Get('logs')
  @Permissions('store:membership_access:read')
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
  @Permissions('store:membership_access:read')
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
  @Permissions('store:membership_access:create')
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
  @Permissions('store:membership_access:update')
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
  @Permissions('store:membership_access:update')
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
