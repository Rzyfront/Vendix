interface PersonName {
  first_name?: string | null;
  last_name?: string | null;
}

/** Minimal provider shape needed to name it. */
export interface ProviderNameSource {
  id?: number | null;
  display_name?: string | null;
  user?: PersonName | null;
  employee?: PersonName | null;
}

const fullName = (person?: PersonName | null): string =>
  [person?.first_name, person?.last_name]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ');

/**
 * Display name of a service provider: `display_name` → linked store user →
 * legacy payroll employee → `''`. User-backed providers have no employee, so
 * every reader must go through here instead of `provider.employee.*`.
 */
export function providerDisplayName(
  provider?: ProviderNameSource | null,
): string {
  if (!provider) return '';
  return (
    provider.display_name?.trim() ||
    fullName(provider.user) ||
    fullName(provider.employee) ||
    ''
  );
}
