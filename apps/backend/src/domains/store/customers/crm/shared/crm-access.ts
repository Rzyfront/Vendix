import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodeEntry, VendixHttpException } from '../../../../../common/errors';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';

/**
 * One rule for the whole store CRM (DECISIONES §6): owner, super admin and
 * whoever can assign (`store:crm_inbox:assign`, i.e. owner/admin roles) see
 * every conversation, task and opportunity of the store. Seller and cashier
 * only see what is assigned to them.
 */
export const CRM_SEE_ALL_PERMISSION = 'store:crm_inbox:assign';

export interface CrmViewer {
  store_id: number;
  user_id: number;
  can_see_all: boolean;
}

/** Store and user of the request; `missing` is thrown when there is none. */
export function resolveCrmViewer(missing: ErrorCodeEntry): CrmViewer {
  const context = RequestContextService.getContext();
  if (!context?.store_id || !context.user_id) {
    throw new VendixHttpException(missing);
  }
  return {
    store_id: context.store_id,
    user_id: context.user_id,
    can_see_all:
      !!context.is_super_admin ||
      !!context.is_owner ||
      !!context.permissions?.includes(CRM_SEE_ALL_PERMISSION),
  };
}

/**
 * Active member of the store of the request whose role grants `permission`,
 * so whatever is assigned to them is never invisible to them (and never
 * assigned to a customer). `store_users` is store-scoped by the client.
 */
export async function isActiveStoreStaff(
  prisma: StorePrismaService,
  userId: number,
  permission: string,
): Promise<boolean> {
  const row = await prisma.store_users.findFirst({
    where: {
      user_id: userId,
      user: {
        state: 'active',
        user_roles: {
          some: {
            roles: {
              role_permissions: {
                some: {
                  permissions: { name: permission, status: 'active' },
                },
              },
            },
          },
        },
      },
    },
    select: { id: true },
  });
  return !!row;
}

/** The customer belongs to the store of the request (`store_users` is scoped). */
export async function isStoreCustomer(
  prisma: StorePrismaService,
  customerId: number,
): Promise<boolean> {
  const row = await prisma.store_users.findFirst({
    where: { user_id: customerId },
    select: { id: true },
  });
  return !!row;
}
