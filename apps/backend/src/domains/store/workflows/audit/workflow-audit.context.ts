import { AsyncLocalStorage } from 'async_hooks';

/**
 * Network origin of the HTTP request being audited (flujos-adm P7.2). The
 * request context of the app carries no IP or user agent, so the Flows audit
 * interceptor opens this store around every Flows / Documents handler and
 * `WorkflowAuditService` reads it when it appends a row. Outside a request
 * (cron, outbox) it is empty and the row keeps both columns null.
 */
export interface WorkflowAuditOrigin {
  ip_address: string | null;
  user_agent: string | null;
}

export class WorkflowAuditRequestContext {
  private static readonly storage = new AsyncLocalStorage<WorkflowAuditOrigin>();

  static run<T>(origin: WorkflowAuditOrigin, fn: () => T): T {
    return this.storage.run(origin, fn);
  }

  static current(): WorkflowAuditOrigin | undefined {
    return this.storage.getStore();
  }
}
