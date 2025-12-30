import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';

@Injectable()
export class AccessValidationService {
  constructor(private prisma: GlobalPrismaService) { }

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
      throw new NotFoundException(`Store with ID ${storeId} not found`);
    }

    // 0. Bypass for super_admin
    const isSuperAdmin = user.user_roles?.some(
      (userRole: any) => userRole.roles?.name === 'super_admin',
    );

    if (isSuperAdmin) {
      return true;
    }

    // 1. Check if user is an Organization Admin/Owner for the store's organization
    // Users with organization-level access (Owner, Org Admin) have access to all stores in their org
    const hasOrgLevelRoleForStoreOrg =
      user.organization_id === store.organization_id &&
      user.user_roles?.some(
        (userRole: any) =>
          userRole.roles?.name === 'owner' ||
          userRole.roles?.name === 'admin' ||
          userRole.roles?.name === 'org_admin'
      );

    if (hasOrgLevelRoleForStoreOrg) {
      return true;
    }

    // 2. Check direct store access via store_users table
    // Fetch store_users relation directly since it might not be populated on the user object
    // We use this.prisma (GlobalPrismaService) to query the relation
    const storeUser = await this.prisma.store_users.findUnique({
      where: {
        store_id_user_id: {
          store_id: storeId,
          user_id: user.id
        }
      }
    });

    if (storeUser) {
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

    // Verify organization access
    // We check if the user's assigned organization_id matches the target
    if (user.organization_id === organizationId) {
      return true;
    }

    // Also check if any role grants specific access (if logic required, but usually org_id on user is authoratative for membership)
    // For now, if the token says they belong to the org, they have access.
    // Logic for "belongsToOrg" is redundant if we check user.organization_id

    // Check if they have an org-admin role (just in case strict role check is needed)
    const hasOrgAdminRole = user.user_roles?.some(
      (ur: any) =>
        (ur.roles?.name === 'owner' || ur.roles?.name === 'admin' || ur.roles?.name === 'org_admin')
    );

    if (hasOrgAdminRole && user.organization_id === organizationId) {
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
      if (userRole.roles?.organization_id) {
        orgIds.add(userRole.roles.organization_id);
      }
    });

    if (user.organization_id) {
      orgIds.add(user.organization_id);
    }

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
