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
}
