import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { UserRoleAssignmentService } from '@common/services/user-role-assignment.service';
import { StaffProvisioningService } from '@common/services/staff-provisioning.service';
import { RoleActor } from '@common/utils/role-scope.util';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';

/**
 * Actor de nivel PLATAFORMA. No lleva tenant: el superadmin ve y edita los tres
 * alcances. Se declara una sola vez y se reutiliza para que ningún endpoint de
 * superadmin construya un actor a mano con un tenant colado por accidente.
 */
export const SUPERADMIN_ROLE_ACTOR: RoleActor = { level: 'superadmin' };

/**
 * Roles cuya asignación/remoción no puede hacerse por API de gestión ni
 * siquiera desde superadmin: quitarse `super_admin` deja la plataforma sin
 * administrador y es irrecuperable por UI.
 */
const UNREMOVABLE_ROLE_NAMES: readonly string[] = ['super_admin'];

export interface SuperadminAssignmentInput {
  user_id: number;
  role_id: number;
  /** `undefined`/`null` = asignación org-wide; número = específica de esa tienda. */
  store_id?: number | null;
}

/**
 * QUI-72 — Fachada de nivel plataforma sobre `UserRoleAssignmentService`.
 *
 * Existe por el riesgo explícito del ticket: superadmin expone la relación
 * rol↔usuario en DOS direcciones (`/superadmin/users/:id/roles/:roleId` y
 * `/superadmin/roles/:id/users/:userId`). Si cada controlador escribiera
 * `user_roles` por su cuenta las dos vistas del mismo dato divergirían.
 *
 * La escritura cruda vive en `UserRoleAssignmentService` (compartido con
 * organización y tienda). Esta fachada añade lo que es EXCLUSIVO del nivel
 * plataforma y debe valer igual en las dos direcciones:
 *   1. el actor `superadmin` fijo,
 *   2. la guarda de roles irremovibles (`super_admin`),
 *   3. el efecto colateral CD7 de aprovisionamiento de staff.
 *
 * Sin (3) aquí, asignar por `users/*` vincularía al usuario con su tienda y
 * asignar por `roles/*` no — misma fila en `user_roles`, distinto sistema.
 */
@Injectable()
export class SuperadminRoleAssignmentService {
  private readonly logger = new Logger(SuperadminRoleAssignmentService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly assignments: UserRoleAssignmentService,
    private readonly staffProvisioning: StaffProvisioningService,
  ) {}

  // ===== READ =====

  /** Dirección rol → usuarios. */
  listRoleUsers(roleId: number) {
    return this.assignments.listRoleUsers(roleId, SUPERADMIN_ROLE_ACTOR);
  }

  /** Dirección usuario → roles. */
  listUserRoles(userId: number) {
    return this.assignments.listUserRoles(userId, SUPERADMIN_ROLE_ACTOR);
  }

  // ===== WRITE =====

  async assign(input: SuperadminAssignmentInput) {
    const result = await this.assignments.assign({
      user_id: input.user_id,
      role_id: input.role_id,
      actor: SUPERADMIN_ROLE_ACTOR,
      store_id: input.store_id,
    });

    try {
      await this.provisionStaffMembership(
        input.user_id,
        input.role_id,
        result.store_id,
      );
    } catch (err) {
      // El contrato histórico de `superadmin/users/:id/roles/:roleId` era
      // todo-o-nada (INSERT + aprovisionamiento en la misma transacción). Al
      // delegar la escritura ya no comparten transacción, así que se compensa
      // borrando la asignación recién creada; de lo contrario un fallo de
      // aprovisionamiento dejaría un rol asignado que el cliente cree fallido.
      await this.prisma.user_roles
        .delete({ where: { id: result.assignment_id } })
        .catch((cleanupErr) =>
          this.logger.error(
            `No se pudo revertir la asignación ${result.assignment_id} tras fallar el aprovisionamiento`,
            cleanupErr instanceof Error ? cleanupErr.stack : cleanupErr,
          ),
        );
      throw err;
    }

    return result;
  }

  async remove(input: SuperadminAssignmentInput) {
    const role = await this.prisma.roles.findUnique({
      where: { id: input.role_id },
      select: { id: true, name: true },
    });

    if (!role) {
      throw new VendixHttpException(ErrorCodes.SUP_ADMIN_ROLE_001);
    }

    if (UNREMOVABLE_ROLE_NAMES.includes(role.name.toLowerCase())) {
      throw new VendixHttpException(
        ErrorCodes.SUP_ADMIN_PERM_001,
        'The super_admin role cannot be removed through the management API',
        { role: role.name },
      );
    }

    return this.assignments.remove({
      user_id: input.user_id,
      role_id: input.role_id,
      actor: SUPERADMIN_ROLE_ACTOR,
      store_id: input.store_id,
    });
  }

  // ===== PRIVATE =====

  /**
   * CD7 — vínculo de tienda tras asignar un rol de staff.
   *
   * Si la asignación es específica de una tienda, esa tienda ES el destino; no
   * tiene sentido inferir otra. Sólo cuando la asignación es org-wide se cae al
   * heurístico `resolveStoreForStoreAdmin`.
   *
   * Excepción documentada: si no hay tienda elegible el usuario queda sin
   * vínculo automático y se resuelve en un segundo paso manual. `customer` y
   * `super_admin` nunca se vinculan (su acceso es no-staff / cross-tenant).
   */
  private async provisionStaffMembership(
    userId: number,
    roleId: number,
    assignmentStoreId: number | null,
  ): Promise<void> {
    const [user, role] = await Promise.all([
      this.prisma.users.findUnique({
        where: { id: userId },
        select: { id: true, organization_id: true, main_store_id: true },
      }),
      this.prisma.roles.findUnique({
        where: { id: roleId },
        select: { name: true },
      }),
    ]);

    if (!user || !role) return;

    const organizationId = user.organization_id;
    if (organizationId == null) return;
    if (role.name === 'customer' || role.name === 'super_admin') return;

    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      let storeId = assignmentStoreId;

      if (storeId == null) {
        const store = await this.staffProvisioning.resolveStoreForStoreAdmin(
          {
            id: user.id,
            organization_id: organizationId,
            main_store_id: user.main_store_id,
          },
          StaffProvisioningService.hasHighPrivilege([role.name]),
          tx,
        );
        storeId = store?.id ?? null;
      }

      if (storeId == null) return;

      await this.staffProvisioning.provisionStaffMembership(tx, {
        userId: user.id,
        storeId,
        organizationId,
        setAppType: false,
        setMainStore: 'if-empty',
      });
    });
  }
}
