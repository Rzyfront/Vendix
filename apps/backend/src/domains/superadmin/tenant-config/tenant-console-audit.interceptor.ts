import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

import { AuditAction, AuditService } from '@common/audit/audit.service';
import {
  RequestContextService,
  type RequestContext,
} from '@common/context/request-context.service';
import { TenantContextRunner } from '@common/context/tenant-context-runner.service';

import { toTenantTarget } from './dto/tenant-scope-param.dto';

/**
 * Auditoría de la consola de tenants del super admin.
 *
 * El interceptor global (`AuditInterceptor`) no sirve aquí y por eso este
 * namespace está en su lista de exclusión: aquel resuelve la organización
 * desde el contexto ALS de la petición, que en este rail es la del **super
 * admin**, no la del tenant configurado. Una fila así deja el rastro en el
 * tenant equivocado, que es exactamente lo contrario de lo que se necesita
 * cuando alguien pregunta quién tocó el certificado de un cliente.
 *
 * Este interceptor resuelve el tenant desde la URL y escribe `organization_id`
 * y `store_id` **explícitos**, con `user_id` del super admin que ejecutó la
 * acción. Corre fuera del `runAsTenant` del handler a propósito: el contexto
 * forjado ya se destruyó cuando llega el `tap`, así que nada puede tomarse
 * prestado del ALS.
 *
 * Solo audita escrituras y solo cuando el handler terminó bien: un 400 de
 * validación no cambió nada del tenant y ensuciaría el rastro.
 */
@Injectable()
export class TenantConsoleAuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(TenantConsoleAuditInterceptor.name);

  /** Solo el rail de la consola de tenants pasa por aquí. */
  private static readonly NAMESPACE = '/superadmin/tenants';

  private static readonly MUTATING_METHODS = new Set([
    'POST',
    'PATCH',
    'PUT',
    'DELETE',
  ]);

  /**
   * Claves cuyo valor jamás debe llegar a `audit_logs`.
   *
   * La tabla es legible desde el panel de auditoría, así que escribir aquí un
   * `software_pin` o la contraseña de un `.p12` equivale a publicarlos. La
   * redacción es por nombre de clave y recursiva: los payloads DIAN anidan
   * secretos dentro de objetos de configuración.
   */
  private static readonly REDACTED_KEYS = new Set([
    'password',
    'certificate_password',
    'certificate_password_encrypted',
    'software_pin',
    'software_pin_encrypted',
    'technical_key',
    'private_key',
    'certificate_base64',
    'certificate_file',
    'p12',
    'token',
    'access_token',
    'refresh_token',
    'secret',
  ]);

  constructor(
    private readonly audit: AuditService,
    private readonly runner: TenantContextRunner,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const url: string = String(request.url ?? '');
    const method: string = String(request.method ?? '').toUpperCase();

    const inNamespace = url
      .split('?')[0]
      .toLowerCase()
      .includes(TenantConsoleAuditInterceptor.NAMESPACE);

    if (
      !inNamespace ||
      !TenantConsoleAuditInterceptor.MUTATING_METHODS.has(method)
    ) {
      return next.handle();
    }

    // Se captura ANTES de ejecutar el handler: el cuerpo puede mutarse dentro
    // (pipes de transformación, servicios que normalizan en sitio).
    const snapshot = {
      params: { ...(request.params ?? {}) },
      body: this.redact(request.body),
      query: this.redact(request.query),
      hasFile: Boolean(request.file || request.files),
      actorId: request.user?.id as number | undefined,
      ip: this.firstIp(request),
      userAgent: String(request.headers?.['user-agent'] ?? ''),
      path: url.split('?')[0],
      method,
      // El contexto ALS de la petición se captura AQUÍ porque en el `tap` ya
      // no existe: el ALS muere con el handler, y `TenantContextRunner.resolve`
      // exige contexto de super admin ambiente. Sin esta copia, cada escritura
      // se quedaba sin auditar con un warning "requiere un contexto de super
      // administrador" — el guard bloqueando a su propio auditor.
      ambient: RequestContextService.getContext() ?? null,
    };

    return next.handle().pipe(
      tap((payload) => {
        // Fire-and-forget: una auditoría que falla no puede tumbar una
        // configuración que ya se aplicó al tenant.
        void this.write(snapshot, payload);
      }),
    );
  }

  private async write(
    snapshot: {
      params: Record<string, any>;
      body: any;
      query: any;
      hasFile: boolean;
      actorId?: number;
      ip: string;
      userAgent: string;
      path: string;
      method: string;
      ambient: RequestContext | null;
    },
    payload: unknown,
  ): Promise<void> {
    try {
      const scopeParam = String(snapshot.params.scope ?? '');
      const tenantIdParam = Number(snapshot.params.tenantId);

      if (!scopeParam || !Number.isInteger(tenantIdParam) || !snapshot.ambient) {
        return;
      }

      // Se reinstala el contexto capturado para resolver el tenant: es el mismo
      // que autorizó la petición, no uno fabricado, así que el guard de super
      // admin del runner sigue significando lo que dice.
      const scope = await RequestContextService.runIsolated(
        snapshot.ambient,
        () => this.runner.resolve(toTenantTarget(scopeParam, tenantIdParam)),
      );

      await this.audit.log({
        userId: snapshot.actorId,
        // Explícitos y del TENANT: sin ellos `AuditService` cae al contexto
        // ALS, que en este rail es la organización del super admin.
        organizationId: scope.organization_id,
        storeId: scope.store_id ?? undefined,
        action: this.actionFor(snapshot.method),
        resource: this.resourceFor(snapshot.path),
        resourceId: this.resourceIdFor(snapshot.params, payload),
        // La marca del rail va DENTRO de `new_values`, no en `metadata`:
        // `audit_logs` no tiene columna `metadata` y `AuditService.log()`
        // acepta el campo y lo descarta en silencio (`:74-95` nunca lo mapea).
        // Pasarlo ahí habría dejado el rastro sin la única marca que permite
        // distinguir "lo cambió soporte" de "lo cambió el comerciante".
        newValues: {
          via: 'superadmin_tenant_console',
          method: snapshot.method,
          path: snapshot.path,
          query: snapshot.query,
          tenant_scope: scopeParam,
          fiscal_scope: scope.fiscal_scope,
          // El binario del certificado nunca se guarda; solo el hecho de que
          // hubo una subida, que es lo que se audita.
          file_uploaded: snapshot.hasFile || undefined,
          payload: snapshot.body,
        },
        ipAddress: snapshot.ip,
        userAgent: snapshot.userAgent,
      });
    } catch (error) {
      this.logger.warn(
        `No se pudo auditar la acción de consola de tenants ${snapshot.method} ${snapshot.path}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private actionFor(method: string): AuditAction {
    if (method === 'POST') return AuditAction.CREATE;
    if (method === 'DELETE') return AuditAction.DELETE;
    return AuditAction.UPDATE;
  }

  /**
   * Recurso real tocado, no "stores".
   *
   * Un cambio de configuración DIAN registrado como edición de tienda es
   * indistinguible de renombrar el comercio cuando alguien audita el incidente
   * meses después.
   */
  private resourceFor(path: string): string {
    const lower = path.toLowerCase();
    if (lower.includes('/dian-config')) return 'dian_configurations';
    if (lower.includes('/resolutions')) return 'invoice_resolutions';
    if (lower.includes('/settings')) return 'settings';
    return 'tenant_config';
  }

  private resourceIdFor(
    params: Record<string, any>,
    payload: unknown,
  ): number | undefined {
    const candidates = [
      params.configId,
      params.resolutionId,
      params.id,
      params.tenantId,
    ];

    for (const candidate of candidates) {
      const value = Number(candidate);
      if (Number.isInteger(value) && value > 0) return value;
    }

    // En un POST el id sale de la respuesta, no de la ruta.
    const created = (payload as any)?.data?.id;
    return Number.isInteger(created) ? created : undefined;
  }

  private firstIp(request: any): string {
    const raw = request.ip || request.connection?.remoteAddress;
    return Array.isArray(raw) ? String(raw[0]) : String(raw ?? '');
  }

  /**
   * Copia redactada del payload. Nunca muta el original: el handler todavía
   * no lo ha usado cuando esto corre.
   */
  private redact(value: unknown, depth = 0): unknown {
    if (value === null || value === undefined) return value;
    if (depth > 6) return '[depth-limit]';

    if (Array.isArray(value)) {
      return value.map((item) => this.redact(item, depth + 1));
    }

    if (Buffer.isBuffer(value)) return '[binary]';

    if (typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, raw] of Object.entries(value as Record<string, any>)) {
        out[key] = TenantConsoleAuditInterceptor.REDACTED_KEYS.has(
          key.toLowerCase(),
        )
          ? '[redacted]'
          : this.redact(raw, depth + 1);
      }
      return out;
    }

    return value;
  }
}
