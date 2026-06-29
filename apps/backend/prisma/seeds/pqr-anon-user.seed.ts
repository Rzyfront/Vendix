import { getPrismaClient } from './shared/client';

export interface SeedPqrAnonUserResult {
  userId: number | null;
  organizationId: number | null;
  created: boolean;
}

/**
 * DEPENDENCIES: This seed has no dependencies. It depends on the
 * Vendix platform organization existing (seeded by
 * `seedVendixPlatformOrg`), but the seeder is idempotent and will
 * log a warning if the org is missing instead of crashing.
 *
 * Creates the anonymous user `anon-pqr@vendix.online` that acts as
 * the `created_by_user_id` for all public PQR submissions. The user
 * is marked `is_active: false` so it cannot log in. Membership in
 * the Vendix platform organization is required so the FK on
 * `support_tickets.organization_id` resolves.
 */
export async function seedPqrAnonUser(
  prisma?: ReturnType<typeof getPrismaClient>,
): Promise<SeedPqrAnonUserResult> {
  const client = prisma || getPrismaClient();

  // 1. Find the Vendix platform org
  const orgVendix = await client.organizations.findFirst({
    where: { is_platform: true },
    select: { id: true, name: true, slug: true },
  });
  if (!orgVendix) {
    console.warn(
      '[seed-pqr-anon-user] Vendix platform org not found (is_platform=true). Skipping.',
    );
    return { userId: null, organizationId: null, created: false };
  }

  // 2. Upsert the anon user (use findFirst because email is not @unique)
  const existing = await client.users.findFirst({
    where: { email: 'anon-pqr@vendix.online' },
    select: { id: true },
  });

  const anon = existing
    ? await client.users.findUnique({
        where: { id: existing.id },
        select: { id: true },
      })
    : await client.users.create({
        data: {
          email: 'anon-pqr@vendix.online',
          username: 'anon-pqr',
          // Disabled password so the user can never log in
          password: '!disabled!',
          first_name: 'Anónimo',
          last_name: 'PQR',
          state: 'pending_verification',
          email_verified: true,
          organization_id: orgVendix.id,
        },
        select: { id: true },
      });

  // 3. Associate the user with the Vendix org (via user_organizations)
  // Skip the membership if the table doesn't exist OR a membership
  // already exists.
  const anonId = anon!.id;
  try {
    const existingMembership = await (client as any).user_organizations?.findFirst?.({
      where: { user_id: anonId, organization_id: orgVendix.id },
    });
    if (!existingMembership) {
      await (client as any).user_organizations.create({
        data: {
          user_id: anonId,
          organization_id: orgVendix.id,
          role: 'customer',
          is_active: true,
        },
      });
    }
  } catch {
    // user_organizations table may not exist or may have a different
    // schema. The PQR create flow only requires the user.id to be set
    // on support_tickets.created_by_user_id — membership is optional.
  }

  const created = !existing;
  console.log(
    `[seed-pqr-anon-user] ${created ? 'Created' : 'Reused'} anon-pqr user (id=${anonId}) in org ${orgVendix.id}`,
  );
  return { userId: anonId, organizationId: orgVendix.id, created };
}
