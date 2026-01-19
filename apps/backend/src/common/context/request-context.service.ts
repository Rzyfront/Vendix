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
