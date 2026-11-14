import {
  STORE_AUTH_DOMAINS_INCLUDE,
  STORE_PUBLIC_LINK_APP_TYPES,
} from './store-public-domains.constants';

// QUI-980 — the auth payload must carry non-primary STORE_HOME/STORE_LANDING
// domains for the sidebar link without dropping the primaries other screens
// (POS invoice link on the ecommerce domain, CRM preview) still read.
describe('STORE_AUTH_DOMAINS_INCLUDE (QUI-980)', () => {
  it('lists the sidebar link app types in priority order', () => {
    expect(STORE_PUBLIC_LINK_APP_TYPES).toEqual([
      'STORE_HOME',
      'STORE_LANDING',
    ]);
  });

  it('keeps active primaries and adds active STORE_HOME/STORE_LANDING', () => {
    expect(STORE_AUTH_DOMAINS_INCLUDE.where).toEqual({
      status: 'active',
      OR: [
        { is_primary: true },
        { app_type: { in: ['STORE_HOME', 'STORE_LANDING'] } },
      ],
    });
  });

  it('orders primaries first so domain_settings[0] stays a primary', () => {
    expect(STORE_AUTH_DOMAINS_INCLUDE.orderBy).toEqual([
      { is_primary: 'desc' },
      { id: 'asc' },
    ]);
  });
});
