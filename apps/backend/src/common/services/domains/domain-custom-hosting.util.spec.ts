import {
  buildDomainDnsInstructions,
  buildInheritedDomainConfig,
  decorateDomainWithSslFields,
  getCertificateDomainNames,
  getOneLevelSubdomainLabel,
  hasIssuedWildcardSsl,
} from './domain-custom-hosting.util';

describe('domain custom hosting utilities', () => {
  const rootDomain = {
    id: 1,
    hostname: 'example.com',
    ownership: 'custom_domain',
    status: 'active',
    ssl_status: 'issued',
    verification_token: 'vdx_token',
    last_verified_at: new Date('2026-01-01T00:00:00Z'),
    validation_cname_name: null,
    validation_cname_value: null,
    config: {
      ssl: {
        wildcard_hostname: '*.example.com',
        wildcard_status: 'issued',
        validation_records: [
          {
            domain_name: 'example.com',
            record_type: 'CNAME',
            name: '_abc.example.com.',
            value: '_abc.acm-validations.aws.',
            validation_status: 'SUCCESS',
          },
          {
            domain_name: '*.example.com',
            record_type: 'CNAME',
            name: '_abc.example.com.',
            value: '_abc.acm-validations.aws.',
            validation_status: 'SUCCESS',
          },
        ],
      },
    },
  };

  it('requests apex plus wildcard names for root custom domains', () => {
    expect(getCertificateDomainNames(rootDomain)).toEqual([
      'example.com',
      '*.example.com',
    ]);
  });

  it('dedupes ACM records and includes apex plus wildcard routing instructions', () => {
    const payload = buildDomainDnsInstructions({
      domain: rootDomain,
      edgeHost: 'edge.vendix.online',
      verificationToken: rootDomain.verification_token,
    });

    expect(payload.ownership_status).toBe('complete');
    expect(payload.certificate_status).toBe('complete');
    expect(payload.instructions.filter((r) => r.group === 'certificate')).toHaveLength(
      1,
    );
    expect(payload.instructions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          record_type: 'ALIAS/ANAME',
          name: '@',
          value: 'edge.vendix.online',
          group: 'routing',
          scope: 'root',
        }),
        expect.objectContaining({
          record_type: 'CNAME',
          name: '*',
          value: 'edge.vendix.online',
          group: 'routing',
          scope: 'wildcard',
        }),
      ]),
    );
  });

  it('detects one-level subdomains only', () => {
    expect(getOneLevelSubdomainLabel('promo.example.com', 'example.com')).toBe(
      'promo',
    );
    expect(
      getOneLevelSubdomainLabel('deep.promo.example.com', 'example.com'),
    ).toBeNull();
  });

  it('marks subdomains as inherited from an issued wildcard parent', () => {
    expect(hasIssuedWildcardSsl(rootDomain)).toBe(true);

    const inheritedConfig = buildInheritedDomainConfig({}, rootDomain);
    const inheritedDomain = {
      id: 2,
      hostname: 'promo.example.com',
      ownership: 'custom_subdomain',
      status: 'active',
      ssl_status: 'issued',
      verification_token: null,
      last_verified_at: new Date('2026-01-01T00:00:00Z'),
      validation_cname_name: null,
      validation_cname_value: null,
      config: inheritedConfig,
    };
    const payload = buildDomainDnsInstructions({
      domain: inheritedDomain,
      edgeHost: 'edge.vendix.online',
    });

    expect(decorateDomainWithSslFields(inheritedDomain)).toEqual(
      expect.objectContaining({
        ssl_inherited_from_hostname: 'example.com',
      }),
    );
    expect(payload.ownership_status).toBe('covered_by_parent');
    expect(payload.certificate_status).toBe('covered_by_parent');
    expect(payload.covered_by_parent_hostname).toBe('example.com');
  });
});
