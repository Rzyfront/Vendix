import {
  buildDomainDnsInstructions,
  buildInheritedDomainConfig,
  decorateDomainWithSslFields,
  enrichDomainDnsInstructionsWithDiagnostics,
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
      edgeHost: 'd123.cloudfront.net',
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
          value: 'd123.cloudfront.net',
          group: 'routing',
          scope: 'root',
          provider_host: '@',
          fqdn_name: 'example.com',
        }),
        expect.objectContaining({
          record_type: 'CNAME',
          name: '*',
          value: 'd123.cloudfront.net',
          group: 'routing',
          scope: 'wildcard',
          provider_host: '*',
          fqdn_name: '*.example.com',
        }),
        expect.objectContaining({
          record_type: 'CNAME',
          group: 'certificate',
          provider_host: '_abc',
          fqdn_name: '_abc.example.com',
        }),
      ]),
    );
    expect(payload.target).toBe('d123.cloudfront.net');
    expect(payload.provisioning_stage).toBe('active');
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
      edgeHost: 'd123.cloudfront.net',
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

  it('distinguishes detected certificate DNS from issued certificate state', async () => {
    const payload = buildDomainDnsInstructions({
      domain: {
        ...rootDomain,
        status: 'issuing_certificate',
        ssl_status: 'pending',
      },
      edgeHost: 'd123.cloudfront.net',
    });
    const resolver = {
      resolveTxt: jest.fn(),
      resolveCname: jest.fn().mockResolvedValue({
        records: ['_abc.acm-validations.aws'],
        consensus: true,
        consensusRecords: ['_abc.acm-validations.aws'],
        perResolver: [
          {
            resolver: '1.1.1.1',
            status: 'success',
            records: ['_abc.acm-validations.aws'],
          },
          {
            resolver: '8.8.8.8',
            status: 'success',
            records: ['_abc.acm-validations.aws'],
          },
          { resolver: '9.9.9.9', status: 'error', records: [] },
        ],
      }),
      resolveA: jest.fn().mockResolvedValue({
        records: ['54.1.1.1'],
        consensus: true,
        consensusRecords: ['54.1.1.1'],
        perResolver: [
          { resolver: '1.1.1.1', status: 'success', records: ['54.1.1.1'] },
          { resolver: '8.8.8.8', status: 'success', records: ['54.1.1.1'] },
          { resolver: '9.9.9.9', status: 'success', records: ['54.1.1.1'] },
        ],
      }),
    } as any;

    const enriched = await enrichDomainDnsInstructionsWithDiagnostics(
      payload,
      resolver,
    );

    expect(enriched.certificate_status).toBe('pending');
    expect(enriched.instructions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          group: 'certificate',
          status: 'complete',
          status_reason:
            'Vendix ya ve este CNAME desde DNS público. Ahora falta que el certificado termine de emitirse.',
        }),
      ]),
    );
  });

  it('marks routing as complete when public resolvers see the legacy edge target', async () => {
    const payload = buildDomainDnsInstructions({
      domain: {
        ...rootDomain,
        status: 'pending_alias',
        ssl_status: 'issued',
      },
      edgeHost: 'd123.cloudfront.net',
      legacyEdgeHost: 'edge.vendix.online',
    });
    const resolver = {
      resolveTxt: jest.fn(),
      resolveCname: jest.fn().mockResolvedValue({
        records: ['edge.vendix.online'],
        consensus: true,
        consensusRecords: ['edge.vendix.online'],
        perResolver: [
          {
            resolver: '1.1.1.1',
            status: 'success',
            records: ['edge.vendix.online'],
          },
          {
            resolver: '8.8.8.8',
            status: 'success',
            records: ['edge.vendix.online'],
          },
          { resolver: '9.9.9.9', status: 'error', records: [] },
        ],
      }),
      resolveA: jest.fn().mockResolvedValue({
        records: ['54.1.1.1'],
        consensus: true,
        consensusRecords: ['54.1.1.1'],
        perResolver: [
          { resolver: '1.1.1.1', status: 'success', records: ['54.1.1.1'] },
          { resolver: '8.8.8.8', status: 'success', records: ['54.1.1.1'] },
          { resolver: '9.9.9.9', status: 'success', records: ['54.1.1.1'] },
        ],
      }),
    } as any;

    const enriched = await enrichDomainDnsInstructionsWithDiagnostics(
      payload,
      resolver,
      { legacyEdgeHost: 'edge.vendix.online' },
    );

    expect(enriched.instructions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          group: 'routing',
          status: 'complete',
          routing_target_type: 'legacy_edge_alias',
          seen_in: expect.arrayContaining(['1.1.1.1', '8.8.8.8']),
        }),
      ]),
    );
  });
});
