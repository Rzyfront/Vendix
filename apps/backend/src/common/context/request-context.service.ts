import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';

export type AppTypeScope =
  | 'VENDIX_LANDING'
  | 'VENDIX_ADMIN'
  | 'ORG_LANDING'
  | 'ORG_ADMIN'
  | 'STORE_LANDING'
  | 'STORE_ADMIN'
  | 'STORE_ECOMMERCE';

export interface RequestContext {
  user_id?: number;
  organization_id?: number;
  store_id?: number;
  app_type?: AppTypeScope; // ✅ Scope de dominio del JWT (DomainScopeGuard)
  roles?: string[];
  permissions?: string[];
  is_super_admin: boolean;
  is_owner: boolean;
  email?: string;
  request_id?: string;
  /**
   * The caller's raw bearer token.
   *
   * Carried so the AI api-bridge can replay a `GET` over internal HTTP as the
   * very same user, traversing the real guard chain instead of reimplementing
   * authorization. Never log it and never return it in a response body — it is
   * a live credential, not context.
   */
  access_token?: string;
}

@Injectable()
export class RequestContextService {
  public static asyncLocalStorage = new AsyncLocalStorage<RequestContext>();
  private static currentContext: RequestContext | undefined;

  /**
   * Ejecuta un callback dentro de un contexto de request
   */
  static run<T>(context: RequestContext, callback: () => T): T {
    this.currentContext = context; // For debugging
    return this.asyncLocalStorage.run(context, callback);
  }

  /**
   * Igual que `run`, pero SIN escribir el estático `currentContext`.
   *
   * `run` deja el último contexto en un campo estático de clase que
   * `getContext()` usa como fallback cuando el ALS está vacío. Para el flujo
   * HTTP normal eso es inocuo, pero cualquier código que forje el contexto de
   * un tenant ajeno (consola de super admin, workers, listeners) convertiría
   * ese estático en "el último tenant que alguien miró", y el siguiente
   * ejecutor que corra fuera del ALS lo adoptaría en silencio.
   *
   * Úsalo siempre que el contexto no venga del request del propio usuario.
   */
  static runIsolated<T>(context: RequestContext, callback: () => T): T {
    return this.asyncLocalStorage.run(context, callback);
  }

  /**
   * Obtiene el contexto actual del request
   */
  static getContext(): RequestContext | undefined {
    return this.asyncLocalStorage.getStore() || this.currentContext;
  }

  /**
   * Establece el contexto de dominio (ahora es un alias para actualizar el store actual)
   */
  static setDomainContext(store_id?: number, organization_id?: number) {
    const store = this.asyncLocalStorage.getStore();
    if (store) {
      if (store_id) store.store_id = store_id;
      if (organization_id) store.organization_id = organization_id;
    }
  }

  /**
   * Obtiene el ID de la organización actual
   */
  static getOrganizationId(): number | undefined {
    return this.getContext()?.organization_id;
  }

  /**
   * Obtiene el ID de la tienda actual
   */
  static getStoreId(): number | undefined {
    return this.getContext()?.store_id;
  }

  /**
   * Obtiene el ID del usuario actual
   */
  static getUserId(): number | undefined {
    return this.getContext()?.user_id;
  }

  /**
   * Obtiene el request_id actual (X-Request-Id)
   */
  static getRequestId(): string | undefined {
    return this.getContext()?.request_id;
  }

  /**
   * Verifica si hay contexto de autenticación
   */
  static hasAuthContext(): boolean {
    return !!this.getContext()?.user_id;
  }

  /**
   * Verifica si hay un store_id en el contexto
   */
  static isDomainBased(): boolean {
    return !!this.getContext()?.store_id;
  }

  /**
   * Verifica si el usuario es Super Admin
   */
  static isSuperAdmin(): boolean {
    return this.getContext()?.is_super_admin || false;
  }

  /**
   * Verifica si el usuario es Owner
   */
  static isOwner(): boolean {
    return this.getContext()?.is_owner || false;
  }

  /**
   * Verifica si el usuario tiene un rol específico
   */
  static hasRole(roleName: string): boolean {
    const roles = this.getContext()?.roles || [];
    return roles.includes(roleName);
  }

  /**
   * Obtiene todos los roles del usuario
   */
  static getRoles(): string[] {
    return this.getContext()?.roles || [];
  }

  /**
   * Valida que el usuario tenga acceso a la tienda
   */
  static validateStoreAccess(userStoreId?: number): boolean {
    const contextStoreId = this.getStoreId();
    if (!contextStoreId) return false;

    if (userStoreId && userStoreId !== contextStoreId) {
      return false;
    }

    return true;
  }
}
