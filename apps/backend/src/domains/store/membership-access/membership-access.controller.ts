import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpException,
  MessageEvent,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { Observable, filter, map } from 'rxjs';
import { ResponseService } from '@common/responses/response.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { RequestContextService } from '@common/context/request-context.service';
import { MembershipAccessService } from './membership-access.service';
import { NotificationsSseService } from '../notifications/notifications-sse.service';
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
    private readonly sseService: NotificationsSseService,
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

  /**
   * GET /store/memberships/access/stream — live SSE feed of access decisions
   * (`membership-access` events) for the current store, for an ambient-access
   * screen. Live-only: no historical snapshot, so we never re-establish the
   * ALS request context after the handler returns.
   *
   * Auth: EventSource cannot set the Authorization header, so it authenticates
   * via `?token=`; the JWT strategy already extracts it
   * (`ExtractJwt.fromUrlQueryParameter('token')`). We take `@Req() req` and do
   * NOT declare a `@Query()` DTO — the global ValidationPipe
   * (`forbidNonWhitelisted: true`) would otherwise reject the raw `token` query
   * param and tear the stream down (same rule as notifications/kitchen-fire).
   * The `store_id` comes from the scoped request context, never the client.
   */
  @Sse('stream')
  @Permissions('store:membership_access:read')
  stream(@Req() req: Request): Observable<MessageEvent> {
    const store_id = RequestContextService.getContext()?.store_id;
    if (!store_id) throw new ForbiddenException('Store context required');

    const subject = this.sseService.getOrCreate(store_id);
    req.on('close', () => this.sseService.unsubscribe(store_id));

    return subject.pipe(
      filter((payload: any) => payload?.type === 'membership-access'),
      map((payload) => ({ data: JSON.stringify(payload) }) as MessageEvent),
    );
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
