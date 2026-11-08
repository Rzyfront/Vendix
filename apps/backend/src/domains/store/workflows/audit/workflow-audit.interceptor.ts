import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { AsyncResource } from 'async_hooks';
import { Observable, from, mergeMap } from 'rxjs';
import { RequestContextService } from '@common/context/request-context.service';
import { extractClientIpOptional } from '@common/utils/client-ip.util';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { WorkflowAuditRequestContext } from './workflow-audit.context';
import { WorkflowAuditAction } from './workflow-audit.catalog';
import { WorkflowAuditService } from './workflow-audit.service';

/** Routes of Flows and Documents, public ones included (the API prefix is optional). */
const AUDITED_PATH =
  /^(?:\/api)?\/(?:store\/workflows|store\/documents|store\/workflow-links|public\/workflows|ecommerce\/documents\/sign|ecommerce\/workflows)(?:\/|$)/;
const SECRETS_PATH = /^(?:\/api)?\/store\/workflows\/secrets(?:\/([^/]*))?(?:\/(.*))?$/;
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const MAX_NAME = 160;

interface SecretMutation {
  action: WorkflowAuditAction;
  /** Route id (`/secrets/:id`), when numeric. */
  id: number | null;
  /** Path after the id; present when the route is not a plain create/update/delete. */
  extra: string | null;
}

/** Classifies a call to the secrets routes without knowing their controller. */
export function classifySecretMutation(method: string, path: string): SecretMutation | null {
  const m = SECRETS_PATH.exec(path);
  if (!m || !MUTATING.has(method)) return null;
  const segment = m[1] || null;
  const extra = m[2] || null;
  const id = segment && /^\d+$/.test(segment) ? Number(segment) : null;
  if (!segment && method === 'POST') return { action: 'secret.created', id: null, extra: null };
  if (segment && !extra && (method === 'PUT' || method === 'PATCH')) return { action: 'secret.updated', id, extra: null };
  if (segment && !extra && method === 'DELETE') return { action: 'secret.deleted', id, extra: null };
  // Unknown shape (an action route such as a rotation or a test): never a creation.
  return { action: 'secret.updated', id, extra: [segment, extra].filter(Boolean).join('/') };
}

function nameOf(source: unknown): string | null {
  const name = (source as { name?: unknown } | null | undefined)?.name;
  return typeof name === 'string' && name.trim() ? name.trim().slice(0, MAX_NAME) : null;
}

const SUMMARIES: Partial<Record<WorkflowAuditAction, string>> = {
  'secret.created': 'Creó el secreto',
  'secret.updated': 'Actualizó el secreto',
  'secret.deleted': 'Eliminó el secreto',
};

/**
 * Gives every Flows / Documents request its network origin (IP and browser)
 * for the audit rows, and records the changes of workflow secrets, whose
 * controller is not touched by the audit. Other paths pass through untouched.
 * Only the secret NAME is ever read: the body and the response are never
 * copied into a row.
 *
 * Register it AFTER `RequestContextInterceptor`: the store and the user come
 * from the request context that one opens.
 */
@Injectable()
export class WorkflowAuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(WorkflowAuditInterceptor.name);

  constructor(
    private readonly audit: WorkflowAuditService,
    private readonly prisma: StorePrismaService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest();
    const path = String(req.originalUrl ?? req.url ?? '').split('?')[0];
    if (!AUDITED_PATH.test(path)) return next.handle();

    const origin = {
      ip_address: extractClientIpOptional(req) ?? null,
      user_agent: typeof req.headers?.['user-agent'] === 'string' ? req.headers['user-agent'] : null,
    };
    const secret = classifySecretMutation(String(req.method ?? '').toUpperCase(), path);
    // `next.handle()` binds the async context at the moment it is called. Call
    // it here, synchronously: `intercept` runs inside the store context that
    // RequestContextInterceptor opened, while Nest subscribes to the chain
    // from a promise callback outside it. Calling it later (in a subscriber
    // or a `defer`) gives the handler no store at all.
    return WorkflowAuditRequestContext.run(origin, () =>
      secret ? this.withSecretAudit(req, secret, next.handle()) : next.handle(),
    );
  }

  /**
   * `handled` is the handler, already bound to the store and origin context
   * and still cold: it only runs once the name of the secret is known.
   */
  private withSecretAudit(
    req: { body?: unknown },
    secret: SecretMutation,
    handled: Observable<unknown>,
  ): Observable<unknown> {
    // The row is written after the handler, from a callback that no longer
    // carries the request: bind the write to the store and origin now.
    const recordHere = AsyncResource.bind((name: string | null) => this.record(secret, name));
    // A deleted secret is gone after the handler: read its name first.
    const knownName: Promise<string | null> =
      secret.action === 'secret.deleted' && secret.id
        ? this.prisma.workflow_secrets
            .findFirst({ where: { id: secret.id, store_id: RequestContextService.getStoreId() }, select: { name: true } })
            .then(nameOf)
        : Promise.resolve(nameOf(req.body));
    return from(knownName).pipe(
      mergeMap((preName) =>
        handled.pipe(
          mergeMap(async (response: unknown) => {
            const name =
              preName ?? nameOf((response as { data?: unknown } | null)?.data) ?? nameOf(response);
            await recordHere(name);
            return response;
          }),
        ),
      ),
    );
  }

  /**
   * The change already committed, so a failed audit write cannot undo it nor
   * honestly turn the answer into an error: it is logged for the operator.
   */
  private async record(secret: SecretMutation, name: string | null): Promise<void> {
    const base = SUMMARIES[secret.action] ?? 'Cambió el secreto';
    try {
      await this.audit.recordNow({
        action: secret.action,
        target_type: 'secret',
        target_id: secret.id,
        summary: name ? `${base} «${name}»` : `${base} (sin nombre)`,
        details: { name, ...(secret.extra ? { path: secret.extra } : {}) },
      });
    } catch (e) {
      this.logger.error(`secret audit not written (${secret.action}): ${(e as Error).message}`);
    }
  }
}
