import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  HttpException,
  Optional,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { PerformanceCollectorService } from '../services/performance-collector.service';
import { PlatformAlertService } from '../../../../common/platform-alerts/platform-alert.service';

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

    return next.handle().pipe(
      tap(() => {
        const duration = Number(process.hrtime.bigint() - start) / 1_000_000;
        const statusCode = context.switchToHttp().getResponse().statusCode;
        this.collector.record({ method, path, statusCode, duration });
        this.collector.trackActiveRequest(-1);
        this.alerts?.captureSlowRequest({
          method,
          route: path,
          durationMs: duration,
          statusCode,
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
