import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import { DefaultPanelUIService } from './default-panel-ui.service';
import { VendixHttpException, ErrorCodes } from '../errors';

/**
 * StaffProvisioningService
 *
 * Servicio transversal (@Global) que centraliza las invariantes de integridad
 * de las cuentas de STAFF/OWNER en Vendix. Nace del rediseño de login
 * (email-only + main_store driver) para garantizar el INVARIANTE DURO:
 *
 *   Ningún flujo (login, switch, creación de usuario) puede dejar a un
 *   usuario no-customer sin relación `store_users` y sin `main_store_id`.
 *
 * Agrupa tres responsabilidades que antes vivían duplicadas o dispersas:
 *
 *  1. `assertEmailAvailableForStaff` — unicidad de email para cuentas
 *     no-customer (A1). Los customers pueden repetir email entre orgs.
 *  2. `resolveStoreForStoreAdmin` — resolución determinista de la tienda de
 *     arranque de un STORE_ADMIN (Estrategias 1/2/3), extraída de la lógica
 *     duplicada en `auth.service.ts` y `environment-switch.service.ts`.
 *  3. `provisionStaffMembership` — upsert atómico de `store_users` +
 *     `user_roles` + `user_settings.app_type` + `users.main_store_id`.
 *
 * @remarks
 * Usa `GlobalPrismaService` a propósito: es provisión de identidad a nivel de
 * sistema (cross-tenant admin), no acceso a datos de negocio de un tenant.
 * Los métodos aceptan un `Prisma.TransactionClient` opcional para componerse
 * dentro de la transacción del llamador; si se omite, caen a
 * `withoutScope()` (PrismaClient sin scope).
 */
@Injectable()
export class StaffProvisioningService {
  private readonly logger = new Logger(StaffProvisioningService.name);

  /** Rol que NO cuenta como staff/owner para efectos de unicidad de email (A1). */
  static readonly CUSTOMER_ROLE = 'customer';

  /** Roles con privilegio alto: pueden ser multi-tienda y auto-relacionarse. */
  static readonly HIGH_PRIVILEGE_ROLES = ['owner', 'admin', 'super_admin'];

  constructor(
    private readonly prismaService: GlobalPrismaService,
    private readonly defaultPanelUIService: DefaultPanelUIService,
  ) {}

  /** ¿Alguno de los roles del usuario es de privilegio alto? */
  static hasHighPrivilege(roleNames: string[]): boolean {
    return roleNames.some(
      (r) => r && StaffProvisioningService.HIGH_PRIVILEGE_ROLES.includes(r),
    );
  }

  /**
   * Impone unicidad de email para cuentas NO-customer (A1).
   *
   * Regla de negocio: un correo puede tener a lo sumo UNA cuenta staff/owner
   * en todo Vendix. Puede además tener N cuentas `customer` en otras orgs
   * (esas no bloquean). Un `customer` que quiere volverse staff/owner con el
   * mismo correo se bloquea; un staff que se registra como customer en otra
   * tienda se permite (esa fila customer no dispara esta validación).
   *
   * @throws VendixHttpException ORG_USER_002 (409) si ya existe una cuenta
   *         no-customer con ese email.
   */
  async assertEmailAvailableForStaff(
    email: string,
    opts?: { excludeUserId?: number; client?: Prisma.TransactionClient },
  ): Promise<void> {
    const normalized = email.toLowerCase().trim();
    const db: any = opts?.client ?? this.prismaService.withoutScope();

    const collisions = await db.users.findMany({
      where: {
        email: normalized,
        ...(opts?.excludeUserId ? { id: { not: opts.excludeUserId } } : {}),
        // Al menos un rol distinto de 'customer' => es una cuenta staff/owner.
        user_roles: {
          some: {
            roles: {
              name: { not: StaffProvisioningService.CUSTOMER_ROLE },
            },
          },
        },
      },
      select: { id: true },
    });

    if (collisions.length > 0) {
      throw new VendixHttpException(ErrorCodes.ORG_USER_002);
    }
  }

  /**
   * Resuelve la tienda de arranque de un STORE_ADMIN de forma determinista.
   *
   * Extracción fiel de las Estrategias 1/2/3 que estaban duplicadas en
   * `auth.service.ts:1662-1746` y `environment-switch.service.ts:101-161`:
   *
   *   1. `main_store_id` (si pertenece a la org y el usuario tiene acceso o
   *      es privilegio alto). Si es privilegio alto y no tiene la relación,
   *      la crea (auto-relation).
   *   2. Primera membresía `store_users` de la org.
   *   3. Fallback privilegio alto: cualquier tienda de la org (crea relación).
   *
   * @returns la tienda resuelta, o `null` si no hay ninguna elegible (huérfano).
   */
  async resolveStoreForStoreAdmin(
    user: { id: number; organization_id: number; main_store_id: number | null },
    hasHighPrivilege: boolean,
    client?: Prisma.TransactionClient,
  ): Promise<{ id: number; slug: string; organization_id: number } | null> {
    const db: any = client ?? this.prismaService.withoutScope();

    // Estrategia 1: Main Store
    if (user.main_store_id) {
      const mainStore = await db.stores.findUnique({
        where: { id: user.main_store_id },
      });

      if (mainStore && mainStore.organization_id === user.organization_id) {
        const access = await db.store_users.findUnique({
          where: {
            store_id_user_id: { store_id: mainStore.id, user_id: user.id },
          },
        });

        if (access || hasHighPrivilege) {
          if (hasHighPrivilege && !access) {
            await db.store_users.create({
              data: { store_id: mainStore.id, user_id: user.id },
            });
          }
          return {
            id: mainStore.id,
            slug: mainStore.slug,
            organization_id: mainStore.organization_id,
          };
        }
      }
    }

    // Estrategia 2: Primera membresía de la org (donde YA tiene acceso)
    const firstMembership = await db.store_users.findFirst({
      where: {
        user_id: user.id,
        store: { organization_id: user.organization_id },
      },
      include: { store: true },
    });

    if (firstMembership?.store) {
      return {
        id: firstMembership.store.id,
        slug: firstMembership.store.slug,
        organization_id: firstMembership.store.organization_id,
      };
    }

    // Estrategia 3: Fallback privilegio alto — cualquier tienda de la org
    if (hasHighPrivilege) {
      const firstOrgStore = await db.stores.findFirst({
        where: { organization_id: user.organization_id },
      });

      if (firstOrgStore) {
        await db.store_users.create({
          data: { store_id: firstOrgStore.id, user_id: user.id },
        });
        return {
          id: firstOrgStore.id,
          slug: firstOrgStore.slug,
          organization_id: firstOrgStore.organization_id,
        };
      }
    }

    return null;
  }

  /**
   * Provisión atómica de la membresía de un usuario staff/owner en una tienda.
   *
   * Garantiza en un solo punto (CD5/CD7) que tras crear/actualizar un usuario
   * quede con: relación `store_users`, el rol pedido en `user_roles`,
   * `user_settings.app_type` y `users.main_store_id`. Todo idempotente
   * (upserts) para poder reejecutarse sin duplicar filas.
   *
   * @param tx cliente Prisma (transacción del llamador o `withoutScope()`).
   * @param input.setMainStore  `true` (default) fija el `main_store_id` a esta
   *        tienda siempre; `'if-empty'` solo lo fija si actualmente es NULL
   *        (para no pisar el arranque de un owner multi-tienda existente);
   *        `false` no lo toca.
   * @throws VendixHttpException AUTH_ROLE_001 (404) si `roleName` no existe.
   */
  async provisionStaffMembership(
    tx: Prisma.TransactionClient,
    input: {
      userId: number;
      storeId: number;
      organizationId: number;
      roleName?: string;
      appType?: string;
      setAppType?: boolean;
      setMainStore?: boolean | 'if-empty';
    },
  ): Promise<void> {
    const {
      userId,
      storeId,
      roleName,
      appType = 'STORE_ADMIN',
      setAppType = true,
      setMainStore = true,
    } = input;
    const db: any = tx;

    // 1. Relación store_users (idempotente)
    await db.store_users.upsert({
      where: { store_id_user_id: { store_id: storeId, user_id: userId } },
      update: {},
      create: { store_id: storeId, user_id: userId },
    });

    // 2. Rol en user_roles (idempotente)
    if (roleName) {
      const role = await db.roles.findUnique({ where: { name: roleName } });
      if (!role) {
        throw new VendixHttpException(ErrorCodes.AUTH_ROLE_001);
      }
      await db.user_roles.upsert({
        where: { user_id_role_id: { user_id: userId, role_id: role.id } },
        update: {},
        create: { user_id: userId, role_id: role.id },
      });
    }

    // 3. app_type en user_settings (fuente única de verdad léxica).
    //    En CREATE generamos el panel_ui por defecto (mismo shape que usan
    //    los demás flujos: el objeto completo devuelto por generatePanelUI);
    //    en UPDATE NO tocamos `config` para no pisar panel_ui personalizado.
    const existingSettings = await db.user_settings.findUnique({
      where: { user_id: userId },
      select: { id: true },
    });
    if (existingSettings) {
      // Solo re-escribe app_type si el caller lo pide (setAppType). Para
      // añadir un owner/admin (alto privilegio) como miembro de una tienda
      // NO queremos degradar su app_type ORG_ADMIN → STORE_ADMIN.
      if (setAppType) {
        await db.user_settings.update({
          where: { user_id: userId },
          data: { app_type: appType as any },
        });
      }
    } else {
      const defaultConfig =
        await this.defaultPanelUIService.generatePanelUI(appType);
      await db.user_settings.create({
        data: {
          user_id: userId,
          app_type: appType as any,
          config: defaultConfig as any,
        },
      });
    }

    // 4. main_store_id como driver de la tienda de arranque (CD3/CD4).
    //    'if-empty' evita pisar el arranque de un owner multi-tienda.
    if (setMainStore) {
      if (setMainStore === 'if-empty') {
        const current = await db.users.findUnique({
          where: { id: userId },
          select: { main_store_id: true },
        });
        if (current?.main_store_id == null) {
          await db.users.update({
            where: { id: userId },
            data: { main_store_id: storeId },
          });
        }
      } else {
        await db.users.update({
          where: { id: userId },
          data: { main_store_id: storeId },
        });
      }
    }
  }
}
