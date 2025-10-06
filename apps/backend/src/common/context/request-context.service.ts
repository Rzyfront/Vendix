import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';

export interface RequestContext {
  userId?: number;
  organizationId?: number;
  storeId?: number;
  roles?: string[];
  isSuperAdmin: boolean;
  isOwner: boolean;
  email?: string;
}

@Injectable()
export class RequestContextService {
  private static asyncLocalStorage = new AsyncLocalStorage<RequestContext>();

  /**
   * Ejecuta un callback dentro de un contexto de request
   * Soporta tanto callbacks síncronos como asíncronos
   */
  static run<T>(context: RequestContext, callback: () => T): T {
    return this.asyncLocalStorage.run(context, callback);
  }

  /**
   * Obtiene el contexto actual del request
   */
  static getContext(): RequestContext | undefined {
    return this.asyncLocalStorage.getStore();
  }

  /**
   * Obtiene el ID de la organización actual
   */
  static getOrganizationId(): number | undefined {
    return this.getContext()?.organizationId;
  }

  /**
   * Obtiene el ID de la tienda actual
   */
  static getStoreId(): number | undefined {
    return this.getContext()?.storeId;
  }

  /**
   * Obtiene el ID del usuario actual
   */
  static getUserId(): number | undefined {
    return this.getContext()?.userId;
  }

  /**
   * Verifica si el usuario es Super Admin
   */
  static isSuperAdmin(): boolean {
    return this.getContext()?.isSuperAdmin || false;
  }

  /**
   * Verifica si el usuario es Owner
   */
  static isOwner(): boolean {
    return this.getContext()?.isOwner || false;
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
