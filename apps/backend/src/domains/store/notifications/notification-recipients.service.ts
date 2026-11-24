import { Injectable } from '@nestjs/common';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { CUSTOMER_ROLE_NAME } from '../../../common/utils/vendix-user.util';

/**
 * - `staff`: personal ACTIVO de la tienda (recibe campana, dispositivo y, si lo
 *   pidió, correo).
 * - `customer`: cliente final de la tienda. Solo lo acepta el puente legado
 *   `sendToUser` (avisos al comprador: estado de su pedido, reagenda de su
 *   reserva…): campana + dispositivo, nunca correo.
 */
export type NotificationRecipientKind = 'staff' | 'customer';

export interface NotificationRecipient {
  user_id: number;
  kind: NotificationRecipientKind;
  email: string | null;
  first_name: string | null;
}

export interface ClassifyRecipientsOptions {
  /** Acepta clientes finales vinculados a la tienda (solo `sendToUser`). */
  allow_store_customers?: boolean;
}

/**
 * Quién puede recibir un aviso personal de UNA tienda (plan §3.3). Corre sin
 * contexto (crons, listeners), así que la tienda va siempre explícita.
 *
 * Criterio, igual al del resto del repo (`vendix-user.util.ts`,
 * `store-users.service.ts#staffLookup`, `crm-access.ts`):
 * 1. Tiene vínculo con la tienda (`store_users` de ESA tienda). Sin vínculo no
 *    recibe nada: nunca se avisa a alguien de otra tienda.
 * 2. Es personal de la tienda si tiene al menos un rol distinto de `customer`
 *    que aplique a esa tienda: asignado a la tienda (`user_roles.store_id`) o
 *    a toda su organización (`store_id` null y misma organización).
 * 3. Ese personal solo recibe si su usuario está `active` (dado de baja = nada).
 * 4. Quien no es personal de la tienda es cliente: solo recibe si el llamador
 *    lo permite (`allow_store_customers`).
 */
@Injectable()
export class NotificationRecipientsService {
  constructor(private readonly global_prisma: GlobalPrismaService) {}

  async classify(
    store_id: number,
    user_ids: number[],
    options: ClassifyRecipientsOptions = {},
  ): Promise<Map<number, NotificationRecipient>> {
    const result = new Map<number, NotificationRecipient>();
    const ids = [...new Set(user_ids.filter((id) => Number.isInteger(id) && id > 0))];
    if (ids.length === 0) return result;

    const store = await this.global_prisma.stores.findUnique({
      where: { id: store_id },
      select: { organization_id: true },
    });
    if (!store) return result;

    const links = await this.global_prisma.store_users.findMany({
      where: { store_id, user_id: { in: ids } },
      select: {
        user: {
          select: {
            id: true,
            state: true,
            email: true,
            first_name: true,
            organization_id: true,
            user_roles: {
              select: { store_id: true, roles: { select: { name: true } } },
            },
          },
        },
      },
    });

    for (const { user } of links) {
      if (!user || result.has(user.id)) continue;
      const hasStaffRoleHere = user.user_roles.some((assignment) => {
        const name = assignment.roles?.name;
        if (!name || name === CUSTOMER_ROLE_NAME) return false;
        if (assignment.store_id === store_id) return true;
        return (
          assignment.store_id === null &&
          user.organization_id === store.organization_id
        );
      });

      let kind: NotificationRecipientKind | null = null;
      if (hasStaffRoleHere) {
        kind = user.state === 'active' ? 'staff' : null;
      } else if (options.allow_store_customers) {
        kind = 'customer';
      }
      if (!kind) continue;

      result.set(user.id, {
        user_id: user.id,
        kind,
        email: user.email?.trim() || null,
        first_name: user.first_name ?? null,
      });
    }
    return result;
  }
}
