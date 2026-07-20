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
import { Observable, filter, interval, map, merge } from 'rxjs';
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
  AdjustOccupancyDto,
  RegisterExitDto,
  EnrollmentPingDto,
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
 *   - POST   /credentials/:id/archive → store:membership_access:update (soft archive: hide + free partial unique slot)
 *   - GET  /occupancy          → store:membership_access:read
 *   - POST /exit               → store:membership_access:create (occupancy −1)
 *   - PATCH /occupancy/adjust  → store:membership_access:update (manual delta)
 *   - POST /enrollment-ping    → store:membership_access:create (live fingerprint enrollment fan-out)
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

    const events$ = subject.pipe(
      filter(
        (payload: any) =>
          payload?.type === 'membership-access' ||
          payload?.type === 'occupancy' ||
          payload?.type === 'enrollment',
      ),
      map((payload) => ({ data: JSON.stringify(payload) }) as MessageEvent),
    );

    // Heartbeat every 30s — a periodic keep-alive write so proxies/CDNs don't
    // idle-close the stream. Forcing socket I/O also makes a non-clean
    // disconnect surface as `req.on('close')`, releasing the shared Subject
    // (fixes the SSE heap leak).
    const heartbeat$ = interval(30_000).pipe(
      map(() => ({ data: `: heartbeat ${Date.now()}` }) as MessageEvent),
    );

    return merge(events$, heartbeat$);
  }

  /**
   * POST /store/memberships/access/enrollment-ping
   *
   * Endpoint the biometric device (or a stub integration) calls when it
   * reads a raw fingerprint template. The backend just fans out an
   * `enrollment` SSE event to current subscribers so the credential-creation
   * modal can capture `external_ref` in real time.
   *
   * NOT a verification — we do not check the fingerprint against any
   * existing credential. That happens later when the user assigns the
   * captured template to a credential.
   */
  @Post('enrollment-ping')
  @Permissions('store:membership_access:create')
  async enrollmentPing(@Body() dto: EnrollmentPingDto) {
    try {
      const storeId = this.requireStoreId();
      await this.service.publishEnrollment(storeId, dto.external_ref, dto.device_id);
      return this.responseService.success(
        { published: true },
        'Enrollment ping publicado',
      );
    } catch (error: any) {
      return this.fail(error, 'Error al publicar enrollment ping');
    }
  }

  /**
   * Resolve the current store from the scoped request context (same rule as the
   * service). The occupancy endpoints act on the caller's store; the client
   * never supplies a store id.
   */
  private requireStoreId(): number {
    const storeId = RequestContextService.getContext()?.store_id;
    if (!storeId) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    return storeId;
  }

  @Get('occupancy')
  @Permissions('store:membership_access:read')
  async getOccupancy() {
    try {
      const result = await this.service.getOccupancy(this.requireStoreId());
      return this.responseService.success(result, 'Ocupación (aforo) obtenida');
    } catch (error: any) {
      return this.fail(error, 'Error al obtener la ocupación');
    }
  }

  @Post('exit')
  @Permissions('store:membership_access:create')
  async registerExit(@Body() dto: RegisterExitDto) {
    try {
      const result = await this.service.registerExit(this.requireStoreId(), dto);
      return this.responseService.success(result, 'Salida registrada');
    } catch (error: any) {
      return this.fail(error, 'Error al registrar la salida');
    }
  }

  @Patch('occupancy/adjust')
  @Permissions('store:membership_access:update')
  async adjustOccupancy(@Body() dto: AdjustOccupancyDto) {
    try {
      const result = await this.service.adjustOccupancy(
        this.requireStoreId(),
        dto.delta,
      );
      return this.responseService.updated(result, 'Ocupación ajustada');
    } catch (error: any) {
      return this.fail(error, 'Error al ajustar la ocupación');
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

  /**
   * POST /store/memberships/access/credentials/:id/resend-email
   *
   * Re-send the credential notification email for an existing credential.
   * Reuses `sendCredentialEmail` so the `external_ref` (biometric) branch
   * sends the enrollment notice ONLY — the device reference is never leaked.
   * Same permission as the create endpoint: a re-send is a re-issuance of the
   * credential notification.
   */
  @Post('credentials/:id/resend-email')
  @Permissions('store:membership_access:create')
  async resendCredentialEmail(@Param('id', ParseIntPipe) id: number) {
    try {
      const result = await this.service.resendCredentialEmail(id);
      return this.responseService.success(
        result,
        'Correo de credencial reenviado',
      );
    } catch (error: any) {
      return this.fail(error, 'Error al reenviar el correo de la credencial');
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

  /**
   * Soft-archive a credential — hides it from listings AND frees the partial
   * unique slot (`membership_access_cred_active_uq`) so the operator can
   * re-issue a credential with the same (store, customer, type). Atomic via
   * the service: sets BOTH `deleted_at = now()` AND `is_active = false` in a
   * single UPDATE.
   *
   * Differs from `deactivateCredential` (DELETE /credentials/:id) which only
   * flips `is_active = false` and keeps the row visible to listings/history
   * queries. Archive is the irreversible-feeling "borrar del catálogo" action;
   * deactivate is the reversible "suspender".
   */
  @Post('credentials/:id/archive')
  @Permissions('store:membership_access:update')
  async archiveCredential(@Param('id', ParseIntPipe) id: number) {
    try {
      const result = await this.service.archiveCredential(id);
      return this.responseService.success(
        result,
        'Credencial archivada exitosamente',
      );
    } catch (error: any) {
      return this.fail(error, 'Error al archivar la credencial');
    }
  }
}
