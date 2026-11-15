import {
  PublicLinkDomain,
  resolveOrganizationPublicHostname,
  resolveStorePublicHostname,
} from './public-link-domain.util';

// QUI-980 — sidebar header link: STORE_HOME primary > STORE_HOME >
// STORE_LANDING primary > STORE_LANDING > slug (null). Never ecommerce/admin.
const domain = (
  app_type: string,
  hostname: string,
  extra: Partial<PublicLinkDomain> = {},
): PublicLinkDomain => ({
  app_type,
  hostname,
  is_primary: false,
  status: 'active',
  store_id: 7,
  ...extra,
});

describe('resolveStorePublicHostname (QUI-980)', () => {
  it('prefers the primary STORE_HOME over a non-primary one', () => {
    expect(
      resolveStorePublicHostname([
        domain('STORE_HOME', 'home-alt.vendix.online'),
        domain('STORE_HOME', 'home.vendix.online', { is_primary: true }),
      ]),
    ).toBe('home.vendix.online');
  });

  it('uses a non-primary STORE_HOME when there is no primary one', () => {
    expect(
      resolveStorePublicHostname([
        domain('STORE_HOME', 'home-alt.vendix.online'),
      ]),
    ).toBe('home-alt.vendix.online');
  });

  it('non-primary STORE_HOME beats a primary STORE_LANDING', () => {
    expect(
      resolveStorePublicHostname([
        domain('STORE_LANDING', 'landing.vendix.online', { is_primary: true }),
        domain('STORE_HOME', 'home-alt.vendix.online'),
      ]),
    ).toBe('home-alt.vendix.online');
  });

  it('falls back to STORE_LANDING, primary before non-primary', () => {
    expect(
      resolveStorePublicHostname([
        domain('STORE_LANDING', 'landing-alt.vendix.online'),
        domain('STORE_LANDING', 'landing.vendix.online', { is_primary: true }),
      ]),
    ).toBe('landing.vendix.online');
    expect(
      resolveStorePublicHostname([
        domain('STORE_LANDING', 'landing-alt.vendix.online'),
      ]),
    ).toBe('landing-alt.vendix.online');
  });

  it('never returns ecommerce or admin domains, even when primary', () => {
    expect(
      resolveStorePublicHostname([
        domain('STORE_ECOMMERCE', 'shop.vendix.online', { is_primary: true }),
        domain('STORE_ADMIN', 'admin.vendix.online', { is_primary: true }),
        domain('ORG_ADMIN', 'org-admin.vendix.online', { is_primary: true }),
      ]),
    ).toBeNull();
  });

  it('ignores inactive domains', () => {
    expect(
      resolveStorePublicHostname([
        domain('STORE_HOME', 'home.vendix.online', {
          is_primary: true,
          status: 'pending_dns',
        }),
        domain('STORE_LANDING', 'landing.vendix.online'),
      ]),
    ).toBe('landing.vendix.online');
  });

  it('returns null (slug fallback) for empty or missing domains', () => {
    expect(resolveStorePublicHostname([])).toBeNull();
    expect(resolveStorePublicHostname(null)).toBeNull();
    expect(resolveStorePublicHostname(undefined)).toBeNull();
  });
});

describe('resolveOrganizationPublicHostname (QUI-980)', () => {
  it('never links to a store domain of the organization', () => {
    expect(
      resolveOrganizationPublicHostname([
        domain('STORE_HOME', 'tuerca-mia-store.vendix.online', {
          is_primary: true,
          store_id: 12,
        }),
        domain('STORE_ECOMMERCE', 'tuerca-mia.vendix.online', {
          is_primary: true,
          store_id: 12,
        }),
      ]),
    ).toBeNull();
  });

  it("uses the organization's own ORG_LANDING, never ORG_ADMIN", () => {
    expect(
      resolveOrganizationPublicHostname([
        domain('ORG_ADMIN', 'admin.demo.vendix.online', {
          is_primary: true,
          store_id: null,
        }),
        domain('ORG_LANDING', 'demo.vendix.online', {
          is_primary: true,
          store_id: null,
        }),
      ]),
    ).toBe('demo.vendix.online');
  });
});
