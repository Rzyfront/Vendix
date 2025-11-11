import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AccessValidationService {
  constructor(private prisma: PrismaService) {}

  /**
   * Valida si un usuario tiene acceso a una tienda específica
   * @param storeId ID de la tienda a validar
   * @param user Usuario autenticado con sus roles
   * @returns true si tiene acceso, lanza excepción si no
   */
  async validateStoreAccess(storeId: number, user: any): Promise<boolean> {
    const store = await this.prisma.stores.findUnique({
      where: { id: storeId },
      include: {
        organizations: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!store) {
      throw new NotFoundException('Store not found');
    }

    // Verificar si es super_admin
    const isSuperAdmin = user.user_roles?.some(
      (userRole: any) => userRole.roles?.name === 'super_admin',
    );

    // Si es super_admin, permitir acceso a cualquier tienda
    if (isSuperAdmin) {
      return true;
    }

    // Verificar acceso a nivel de organización
    const hasOrgAccess = user.user_roles?.some(
      (userRole: any) =>
        userRole.organization_id === store.organization_id &&
        userRole.store_id === null, // Rol a nivel de org
    );

    if (hasOrgAccess) {
      return true;
    }

    // Verificar acceso directo a la tienda específica
    const hasStoreAccess = user.user_roles?.some(
      (userRole: any) => userRole.store_id === storeId,
    );

    if (hasStoreAccess) {
      return true;
    }

    throw new ForbiddenException(
      `Access denied to store ${storeId}. You don't have the required permissions.`,
    );
  }

  /**
   * Valida si un usuario tiene acceso a una organización específica
   * @param organizationId ID de la organización a validar
   * @param user Usuario autenticado con sus roles
   * @returns true si tiene acceso, lanza excepción si no
   */
  async validateOrganizationAccess(
    organizationId: number,
    user: any,
  ): Promise<boolean> {
    const organization = await this.prisma.organizations.findUnique({
      where: { id: organizationId },
    });

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    // Verificar si es super_admin
    const isSuperAdmin = user.user_roles?.some(
      (userRole: any) => userRole.roles?.name === 'super_admin',
    );

    // Si es super_admin, permitir acceso a cualquier organización
    if (isSuperAdmin) {
      return true;
    }

    // Verificar acceso a nivel de organización
    const hasOrgAccess = user.user_roles?.some(
      (userRole: any) =>
        userRole.organization_id === organizationId &&
        userRole.store_id === null, // Rol a nivel de org
    );

    if (hasOrgAccess) {
      return true;
    }

    // Verificar si pertenece a la organización (aunque tenga rol de tienda específica)
    const belongsToOrg = user.user_roles?.some(
      (userRole: any) => userRole.organization_id === organizationId,
    );

    if (belongsToOrg) {
      return true;
    }

    throw new ForbiddenException(
      `Access denied to organization ${organizationId}. You don't have the required permissions.`,
    );
  }

  /**
   * Valida si un usuario tiene acceso a los datos de otro usuario
   * @param targetUserId ID del usuario objetivo
   * @param currentUser Usuario autenticado
   * @returns true si tiene acceso, lanza excepción si no
   */
  async validateUserAccess(
    targetUserId: number,
    currentUser: any,
  ): Promise<boolean> {
    // Un usuario solo puede acceder a sus propios datos, o un super_admin puede acceder a cualquier usuario
    const isSuperAdmin = currentUser.user_roles?.some(
      (userRole: any) => userRole.roles?.name === 'super_admin',
    );

    if (currentUser.id !== targetUserId && !isSuperAdmin) {
      throw new ForbiddenException('Access denied to this user');
    }

    return true;
  }

  /**
   * Verifica si un usuario tiene un rol específico
   * @param user Usuario autenticado
   * @param roleName Nombre del rol a verificar
   * @returns true si tiene el rol, false si no
   */
  hasRole(user: any, roleName: string): boolean {
    return (
      user.user_roles?.some(
        (userRole: any) => userRole.roles?.name === roleName,
      ) || false
    );
  }

  /**
   * Verifica si un usuario es super_admin
   * @param user Usuario autenticado
   * @returns true si es super_admin, false si no
   */
  isSuperAdmin(user: any): boolean {
    return this.hasRole(user, 'super_admin');
  }

  /**
   * Obtiene las organizaciones a las que un usuario tiene acceso
   * @param user Usuario autenticado
   * @returns Array de IDs de organizaciones
   */
  getUserOrganizations(user: any): number[] {
    const orgIds = new Set<number>();

    user.user_roles?.forEach((userRole: any) => {
      if (userRole.organization_id) {
        orgIds.add(userRole.organization_id);
      }
    });

    return Array.from(orgIds);
  }

  /**
   * Obtiene las tiendas a las que un usuario tiene acceso
   * @param user Usuario autenticado
   * @returns Array de IDs de tiendas
   */
  getUserStores(user: any): number[] {
    const storeIds = new Set<number>();

    user.user_roles?.forEach((userRole: any) => {
      if (userRole.store_id) {
        storeIds.add(userRole.store_id);
      }
    });

    return Array.from(storeIds);
  }
}
