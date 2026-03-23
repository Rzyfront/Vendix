import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import { RequestContextService } from '../context/request-context.service';

@Injectable()
export class PiiAccessInterceptor implements NestInterceptor {
  private readonly logger = new Logger(PiiAccessInterceptor.name);

  constructor(private readonly prisma: GlobalPrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const method = request.method;
    const url = request.originalUrl || request.url;

    // Only intercept GET requests to PII-sensitive routes
    if (method !== 'GET') {
      return next.handle();
    }

    const is_pii_route =
      url.includes('/customers') || url.includes('/store-users');

    if (!is_pii_route) {
      return next.handle();
    }

    const request_context = RequestContextService.getContext();
    const requesting_user_id = request_context?.user_id;

    // Extract target user ID from route params if present
    const target_user_id = request.params?.id
      ? parseInt(request.params.id, 10)
      : null;

    // Only log when accessing ANOTHER user's data
    if (
      !requesting_user_id ||
      !target_user_id ||
      requesting_user_id === target_user_id
    ) {
      return next.handle();
    }

    return next.handle().pipe(
      tap(() => {
        // Fire and forget - do not await, do not block the response
        this.prisma.audit_logs
          .create({
            data: {
              user_id: requesting_user_id,
              action: 'pii_access',
              resource: 'user_data',
              resource_id: target_user_id,
              ip_address: request.ip,
              new_values: { path: url },
            },
          })
          .catch((error) => {
            this.logger.error('Failed to log PII access', error);
          });
      }),
    );
  }
}
