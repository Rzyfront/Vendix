import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  HttpException,
  Optional,
} from '@nestjs/common';
import { SSE_METADATA } from '@nestjs/common/constants';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { PerformanceCollectorService } from '../services/performance-collector.service';
import { PlatformAlertService } from '../../../../common/platform-alerts/platform-alert.service';
import { safeRouteParams } from '../../../../common/platform-alerts/platform-alert-sanitize';
import { getRequestIdFromRequest } from '../../../../common/middleware/request-id.middleware';

const EXCLUDED_PATHS = [
  '/health',
  '/api-docs',
  '/monitoring/performance',
  '/monitoring/overview',
  '/stream',
];
const UUID_REGEX =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const NUMERIC_ID_REGEX = /\/\d+(?=\/|$)/g;

@Injectable()
export class PerformanceInterceptor implements NestInterceptor {
  constructor(
    private readonly collector: PerformanceCollectorService,
    // QUI-1010: respuestas lentas → alerta informativa del bot de monitoreo.
    @Optional() private readonly alerts?: PlatformAlertService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const url: string = req.url || '';

    // Fast path: skip excluded routes
    if (EXCLUDED_PATHS.some((p) => url.includes(p))) {
      return next.handle();
    }

    const start = process.hrtime.bigint();
    this.collector.trackActiveRequest(1);

    const method = req.method;
    const path = this.getPath(req);
    // QUI-1010: un stream SSE emite durante minutos; su duración no es latencia.
    const isSse = Reflect.getMetadata(SSE_METADATA, context.getHandler()) === true;

    return next.handle().pipe(
      tap(() => {
        const duration = Number(process.hrtime.bigint() - start) / 1_000_000;
        const statusCode = context.switchToHttp().getResponse().statusCode;
        this.collector.record({ method, path, statusCode, duration });
        this.collector.trackActiveRequest(-1);
        if (isSse) return;
        // Identidad explícita: este `tap` corre fuera del AsyncLocalStorage del
        // request, así que la alerta salía como «Plataforma (sin tienda)».
        const who = this.tenantOf(req);
        this.alerts?.captureSlowRequest({
          method,
          route: path,
          durationMs: duration,
          statusCode,
          organizationId: who.organizationId,
          storeId: who.storeId,
          userId: who.userId,
          requestId: getRequestIdFromRequest(req) ?? null,
          params: safeRouteParams(req.params),
        });
      }),
      catchError((err) => {
        const duration = Number(process.hrtime.bigint() - start) / 1_000_000;
        const statusCode = err instanceof HttpException ? err.getStatus() : 500;
        this.collector.record({ method, path, statusCode, duration });
        this.collector.trackActiveRequest(-1);
        throw err;
      }),
    );
  }

  /** Tienda, organización y usuario del request ya autenticado (`req.user`). */
  private tenantOf(req: any): {
    organizationId: number | null;
    storeId: number | null;
    userId: number | null;
  } {
    const user = req?.user ?? {};
    const num = (value: unknown): number | null => {
      const parsed = Number(value);
      return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
    };
    return {
      organizationId: num(user.organization_id),
      storeId: num(user.store_id),
      userId: num(user.id ?? user.user_id),
    };
  }

  private getPath(req: any): string {
    // Prefer NestJS/Express route path (already has :id params)
    if (req.route?.path) {
      return req.route.path;
    }
    // Fallback: normalize the URL manually
    return this.normalizePath(req.url || '');
  }

  private normalizePath(url: string): string {
    let path = url.split('?')[0]; // Remove query string
    path = path.replace(UUID_REGEX, ':uuid');
    path = path.replace(NUMERIC_ID_REGEX, '/:id');
    return path;
  }
}
