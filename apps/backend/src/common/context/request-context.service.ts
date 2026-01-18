import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';

export interface RequestContext {
  user_id?: number;
  organization_id?: number;
  store_id?: number;
  roles?: string[];
  is_super_admin: boolean;
  is_owner: boolean;
  email?: string;
}

export interface DomainContext {
  store_id?: number;
  organization_id?: number;
}

@Injectable()
export class RequestContextService {
  public static asyncLocalStorage = new AsyncLocalStorage<RequestContext>();
  private static currentContext: RequestContext | undefined;
  private static domainContext?: DomainContext;

  /**
   * Ejecuta un callback dentro de un contexto de request
   * Soporta tanto callbacks síncronos como asíncronos
   */
  static run<T>(context: RequestContext, callback: () => T): T {
    this.currentContext = context; // For debugging
    return this.asyncLocalStorage.run(context, callback);
  }

  /**
   * Obtiene el contexto actual del request
   */
  static getContext(): RequestContext | undefined {
    return this.asyncLocalStorage.getStore() || this.currentContext;
  }

  /**
   * Establece el contexto de dominio (llamado por DomainResolverMiddleware)
   */
  static setDomainContext(store_id?: number, organization_id?: number) {
    this.domainContext = { store_id, organization_id };
  }

  /**
   * Obtiene el contexto de dominio
   */
  static getDomainContext(): DomainContext | undefined {
    return this.domainContext;
  }

  /**
   * Limpia el contexto de dominio
   */
  static clearDomainContext() {
    this.domainContext = undefined;
  }

  /**
   * Obtiene el ID de la organización actual
   * Prioridad: Auth context > Domain context
   */
  static getOrganizationId(): number | undefined {
    return (
      this.getContext()?.organization_id || this.domainContext?.organization_id
    );
  }

  /**
   * Obtiene el ID de la tienda actual
   * Para ecommerce: store_id siempre viene del dominio
   * Para admin: store_id viene del JWT
   */
  static getStoreId(): number | undefined {
    // En ecommerce: store_id siempre viene del dominio
    // En admin: store_id viene del JWT
    return this.domainContext?.store_id || this.getContext()?.store_id;
  }

  /**
   * Obtiene el ID del usuario actual
   */
  static getUserId(): number | undefined {
    return this.getContext()?.user_id;
  }

  /**
   * Verifica si hay contexto de autenticación
   */
  static hasAuthContext(): boolean {
    return !!this.getContext()?.user_id;
  }

  /**
   * Verifica si el contexto está basado en dominio
   */
  static isDomainBased(): boolean {
    return !!this.domainContext?.store_id;
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
   * Valida que el usuario tenga acceso a la tienda del dominio
   */
  static validateStoreAccess(userStoreId?: number): boolean {
    const domainStoreId = this.domainContext?.store_id;
    if (!domainStoreId) return false;

    // Si el usuario tiene un store_id en su JWT, debe coincidir con el dominio
    if (userStoreId && userStoreId !== domainStoreId) {
      return false;
    }

    return true;
  }
}
