/**
 * Display helpers for service providers.
 *
 * A provider is now linked to a store user (`user`); providers created before
 * that change may only carry a payroll `employee`. Name resolution order:
 *   1. `display_name`
 *   2. user full name
 *   3. employee full name
 *   4. '' (empty)
 */
export interface PersonNameLike {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  position?: string | null;
}

export interface ProviderNameLike {
  display_name?: string | null;
  user?: PersonNameLike | null;
  employee?: PersonNameLike | null;
}

function fullName(person: PersonNameLike | null | undefined): string {
  if (!person) return '';
  return `${person.first_name ?? ''} ${person.last_name ?? ''}`.trim();
}

export function providerDisplayName(
  provider: ProviderNameLike | null | undefined,
): string {
  if (!provider) return '';
  return (
    provider.display_name?.trim() ||
    fullName(provider.user) ||
    fullName(provider.employee) ||
    ''
  );
}

/** Secondary line: employee position, else the user's email, else ''. */
export function providerSubtitle(
  provider: ProviderNameLike | null | undefined,
): string {
  if (!provider) return '';
  return provider.employee?.position?.trim() || provider.user?.email?.trim() || '';
}
