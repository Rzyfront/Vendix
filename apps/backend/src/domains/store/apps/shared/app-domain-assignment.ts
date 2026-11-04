import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { VendixHttpException } from '@common/errors/vendix-http.exception';
import { ErrorCodes } from '@common/errors/error-codes';
import {
  APP_KIND_BY_APP_TYPE,
  APP_TYPE_LABELS,
  PROTECTED_APP_TYPES,
  isAppOnlyAppType,
  parseAppDomainAliases,
  withAlias,
  withoutAlias,
} from './app-domain-aliases';

/**
 * Apps F5: rules the domain modals (store and organization) apply when a
 * domain is pointed to an app's `app_type` by hand.
 *
 * The store always comes from the domain row the caller already loaded and
 * scoped, never from the request body; reads use the global client because
 * the organization context has no store scope.
 */

/**
 * - An app type of an app needs that app published in the store
 *   (`STORE_APPS_016`).
 * - A domain serving the online store or the admin never moves to an app
 *   (`STORE_APPS_017`), the same rule the apps follow.
 */
export async function assertAppTypeAssignable(
  prisma: GlobalPrismaService,
  params: {
    storeId: number | null | undefined;
    currentAppType: string | null | undefined;
    nextAppType: string;
  },
): Promise<void> {
  const { storeId, currentAppType, nextAppType } = params;
  if (!isAppOnlyAppType(nextAppType) || currentAppType === nextAppType) return;

  if (currentAppType && PROTECTED_APP_TYPES.includes(currentAppType)) {
    throw new VendixHttpException(ErrorCodes.STORE_APPS_017);
  }

  const kind = APP_KIND_BY_APP_TYPE[nextAppType];
  const published = storeId
    ? await prisma.store_apps.findFirst({
        where: { store_id: storeId, kind, status: 'published' },
        select: { id: true },
      })
    : null;
  if (!published) {
    throw new VendixHttpException(
      ErrorCodes.STORE_APPS_016,
      `Publica primero la app «${APP_TYPE_LABELS[nextAppType]}» para usar este dominio con ella.`,
      { app_type: nextAppType, app: kind },
    );
  }
}

/**
 * Keeps the apps' alias lists in step with a manual `app_type` change: the
 * domain leaves the alias list of the app it served and joins the one of the
 * app it serves now, remembering the `app_type` it had, so unpublishing that
 * app gives it back. The app's primary domain is never an alias.
 */
export async function syncAppDomainAssignment(
  prisma: GlobalPrismaService,
  params: {
    storeId: number | null | undefined;
    domainId: number;
    previousAppType: string | null | undefined;
    nextAppType: string;
  },
): Promise<void> {
  const { storeId, domainId, previousAppType, nextAppType } = params;
  if (!storeId || previousAppType === nextAppType) return;

  if (isAppOnlyAppType(previousAppType)) {
    await updateAliases(prisma, storeId, APP_KIND_BY_APP_TYPE[previousAppType], domainId, (list) =>
      withoutAlias(list, domainId),
    );
  }
  if (isAppOnlyAppType(nextAppType)) {
    await updateAliases(prisma, storeId, APP_KIND_BY_APP_TYPE[nextAppType], domainId, (list) =>
      withAlias(list, {
        domain_id: domainId,
        previous_app_type: previousAppType ?? null,
      }),
    );
  }
}

async function updateAliases(
  prisma: GlobalPrismaService,
  storeId: number,
  kind: (typeof APP_KIND_BY_APP_TYPE)[keyof typeof APP_KIND_BY_APP_TYPE],
  domainId: number,
  change: (
    list: ReturnType<typeof parseAppDomainAliases>,
  ) => ReturnType<typeof parseAppDomainAliases>,
): Promise<void> {
  const row = await prisma.store_apps.findFirst({
    where: { store_id: storeId, kind },
    select: { id: true, config: true, domain_settings_id: true },
  });
  if (!row || row.domain_settings_id === domainId) return;

  const current =
    row.config && typeof row.config === 'object' && !Array.isArray(row.config)
      ? (row.config as Record<string, unknown>)
      : {};
  const before = parseAppDomainAliases(current);
  const after = change(before);
  if (JSON.stringify(after) === JSON.stringify(before)) return;

  await prisma.store_apps.update({
    where: { id: row.id },
    data: {
      config: {
        ...current,
        custom_domain_aliases: after,
      } as unknown as Prisma.InputJsonValue,
      updated_at: new Date(),
    },
  });
}
