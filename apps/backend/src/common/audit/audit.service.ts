import { Injectable } from '@nestjs/common';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';

export enum AuditAction {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  LOGIN = 'LOGIN',
  LOGOUT = 'LOGOUT',
  PASSWORD_CHANGE = 'PASSWORD_CHANGE',
  EMAIL_VERIFY = 'EMAIL_VERIFY',
  ONBOARDING_COMPLETE = 'ONBOARDING_COMPLETE',
  PERMISSION_CHANGE = 'PERMISSION_CHANGE',
  LOGIN_FAILED = 'LOGIN_FAILED',
  ACCOUNT_LOCKED = 'ACCOUNT_LOCKED',
  ACCOUNT_UNLOCKED = 'ACCOUNT_UNLOCKED',
  SUSPICIOUS_ACTIVITY = 'SUSPICIOUS_ACTIVITY',
  PASSWORD_RESET = 'PASSWORD_RESET',
  VIEW = 'VIEW',
  SEARCH = 'SEARCH',
  CUSTOM = 'CUSTOM', // ✅ Acción para eventos personalizados
}

export enum AuditResource {
  USERS = 'users',
  ORGANIZATIONS = 'organizations',
  STORES = 'stores',
  DOMAIN_SETTINGS = 'domain_settings',
  PRODUCTS = 'products',
  ORDERS = 'orders',
  AUTH = 'auth',
  ROLES = 'roles',
  PERMISSIONS = 'permissions',
  SYSTEM = 'system',
  ADDRESSES = 'addresses',
  CATEGORIES = 'categories',
  BRANDS = 'brands',
  CUSTOMERS = 'customers',
  SUPPLIERS = 'suppliers',
  INVENTORY = 'inventory',
  STOCK_LEVELS = 'stock_levels',
  TRANSACTIONS = 'transactions',
  PAYMENTS = 'payments',
  TAXES = 'taxes',
  DOMAINS = 'domains',
  SETTINGS = 'settings',
  TEMPLATES = 'templates',
  CUSTOM = 'custom', // ✅ Recurso genérico para eventos personalizados
}

export interface AuditLogData {
  userId?: number;
  storeId?: number;
  organizationId?: number;
  action: AuditAction | string; // Permitir strings arbitrarios para CUSTOM
  resource: AuditResource | string; // Permitir strings arbitrarios para CUSTOM
  resourceId?: number;
  oldValues?: any;
  newValues?: any;
  metadata?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Ancho de `audit_logs.request_id` (`VARCHAR(100)`, ver `schema.prisma`).
 *
 * No es cosmético: `RequestContextInterceptor` acepta el header entrante
 * `X-Request-Id` VERBATIM, así que un tercero puede mandar uno de 4 KB. Si ese
 * valor viajara al INSERT, Postgres rechazaría la fila entera y el `catch` de
 * `log()` se lo tragaría — se perdería TODA la entrada de auditoría, no solo el
 * identificador.
 */
const AUDIT_REQUEST_ID_MAX_LENGTH = 100;

@Injectable()
export class AuditService {
  constructor(private readonly prismaService: GlobalPrismaService) {}

  /**
   * Token de correlación de la petición que produjo esta entrada.
   *
   * Se lee DIRECTO del store de AsyncLocalStorage y no vía
   * `RequestContextService.getRequestId()`, y ahí está todo el punto:
   * `getContext()` cae de vuelta al estático `currentContext` que deja
   * `RequestContextService.run()`. Los processors de BullMQ y los cron forjan
   * contexto con ese `run()` — `accounting-entry-retry.processor.ts:54` incluso
   * fabrica un `request_id` sintético (`accounting-retry-<id>`) — de modo que,
   * una vez que uno de ellos corrió, cualquier auditoría escrita FUERA de un
   * scope ALS heredaría ese identificador rancio y correlacionaría esta fila con
   * una petición que jamás la tocó. Un token de correlación equivocado es peor
   * que ninguno: hace que un investigador lea dos eventos ajenos como una sola
   * cadena causal. Con el ALS vacío la columna se queda en NULL.
   *
   * Dentro de un job que SÍ restauró contexto con `run(ctx)`, el store está
   * poblado y su `request_id` es legítimo: ese sí se persiste.
   *
   * Los valores que no caben en la columna se DESCARTAN, nunca se truncan: un
   * token truncado es un token inventado, y dos peticiones distintas con el
   * mismo prefijo colisionarían en una correlación falsa.
   */
  private resolveRequestId(): string | undefined {
    const requestId =
      RequestContextService.asyncLocalStorage.getStore()?.request_id;

    if (typeof requestId !== 'string' || requestId.length === 0) {
      return undefined;
    }

    return requestId.length <= AUDIT_REQUEST_ID_MAX_LENGTH
      ? requestId
      : undefined;
  }

  /**
   * Registra un evento de auditoría
   */
  async log(auditData: AuditLogData): Promise<void> {
    try {
      // CP-POS-CREAR-EDITAR-COBRAR-001 — F.2 · Round 2 BLOCKER B1.
      // `metadata` was added in the additive migration
      // 20260820000000_audit_logs_metadata; the generated Prisma types do
      // not know about it until the next `prisma generate` runs against
      // the migrated schema. The `as any` below is the SAME pattern the
      // `action`/`resource` columns use to accept untyped strings, so it
      // doesn't open a new escape hatch. JSON.parse(JSON.stringify(...))
      // keeps Prisma happy with Decimal / Date / circular refs the same
      // way the other JSON columns do.
      await this.prismaService.audit_logs.create({
        data: {
          user_id: auditData.userId,
          store_id: auditData.storeId,
          organization_id:
            auditData.organizationId ||
            RequestContextService.getContext()?.organization_id,
          // Si la acción no es parte del Enum, se guarda tal cual (si la BD lo permite) o se mapea a CUSTOM si es muy estricto.
          // Asumimos que la columna en BD es string o enum compatible.
          action: auditData.action as any,
          resource: auditData.resource as any,
          resource_id: auditData.resourceId,
          old_values: auditData.oldValues
            ? JSON.parse(JSON.stringify(auditData.oldValues))
            : null,
          new_values: auditData.newValues
            ? JSON.parse(JSON.stringify(auditData.newValues))
            : null,
          metadata: auditData.metadata
            ? JSON.parse(JSON.stringify(auditData.metadata))
            : null,
          // CP-PURCHASE-TRANSPARENCY H.1.
          // La columna existe desde `20260822180000_purchase_transparency_
          // additive_schema`, pero nadie la escribía: 0 de 33.590 filas la
          // tenían. Ver `resolveRequestId()` para por qué no se usa
          // `getRequestId()` y por qué el valor puede quedar nulo.
          request_id: this.resolveRequestId() ?? null,
          ip_address: auditData.ipAddress,
          user_agent: auditData.userAgent,
        } as any,
      });
    } catch (error) {
      // Error registrando auditoría - log for debugging
      console.error('[AuditService] Error creating audit log:', error.message);
      console.error('[AuditService] Audit data:', {
        userId: auditData.userId,
        action: auditData.action,
        resource: auditData.resource,
        resourceId: auditData.resourceId,
        hasOldValues: !!auditData.oldValues,
        hasNewValues: !!auditData.newValues,
        oldValuesSize: auditData.oldValues
          ? JSON.stringify(auditData.oldValues).length
          : 0,
        newValuesSize: auditData.newValues
          ? JSON.stringify(auditData.newValues).length
          : 0,
      });
    }
  }

  /**
   * Helper para registrar eventos personalizados en flujos específicos
   */
  async logCustom(
    userId: number,
    action: string,
    resource: string,
    metadata?: Record<string, any>,
    resourceId?: number,
  ): Promise<void> {
    await this.log({
      userId,
      action: action,
      resource: resource,
      resourceId,
      metadata,
    });
  }

  async logCreate(
    userId: number,
    resource: AuditResource,
    resourceId: number,
    newValues: any,
    metadata?: Record<string, any>,
  ): Promise<void> {
    await this.log({
      userId,
      action: AuditAction.CREATE,
      resource,
      resourceId,
      newValues,
      metadata,
    });
  }

  async logUpdate(
    userId: number,
    resource: AuditResource,
    resourceId: number,
    oldValues: any,
    newValues: any,
    metadata?: Record<string, any>,
  ): Promise<void> {
    await this.log({
      userId,
      action: AuditAction.UPDATE,
      resource,
      resourceId,
      oldValues,
      newValues,
      metadata,
    });
  }

  async logDelete(
    userId: number,
    resource: AuditResource,
    resourceId: number,
    oldValues: any,
    metadata?: Record<string, any>,
  ): Promise<void> {
    await this.log({
      userId,
      action: AuditAction.DELETE,
      resource,
      resourceId,
      oldValues,
      metadata,
    });
  }

  async logAuth(
    userId: number | undefined,
    action: AuditAction,
    metadata?: Record<string, any>,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    // Extract organization_id and store_id from metadata if provided
    // This is important for auth events (LOGIN, LOGOUT) where RequestContext
    // might not have the context yet
    const organizationId = metadata?.organization_id as number | undefined;
    const storeId = metadata?.store_id as number | undefined;

    // Remove organization_id and store_id from metadata to avoid duplication
    const { organization_id, store_id, ...cleanMetadata } = metadata || {};

    await this.log({
      userId,
      action,
      resource: AuditResource.AUTH,
      organizationId,
      storeId,
      metadata: cleanMetadata,
      ipAddress,
      userAgent,
    });
  }
}
