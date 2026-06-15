import {
  buildDomainRootDnsInstructions,
  getRootCertificateDomainNames,
  isHostnameCoveredByRoot,
} from './domain-root-hosting.util';

describe('domain-root-hosting.util', () => {
  it('builds root plus wildcard certificate names', () => {
    expect(
      getRootCertificateDomainNames({
        id: 1,
        hostname: 'gorrerolicor.online',
        status: 'pending_certificate',
        ssl_status: 'pending',
      }),
    ).toEqual(['gorrerolicor.online', '*.gorrerolicor.online']);
  });

  it('covers only the root and one-level subdomains', () => {
    expect(
      isHostnameCoveredByRoot('gorrerolicor.online', 'gorrerolicor.online'),
    ).toBe(true);
    expect(
      isHostnameCoveredByRoot(
        'promo.gorrerolicor.online',
        'gorrerolicor.online',
      ),
    ).toBe(true);
    expect(
      isHostnameCoveredByRoot(
        'x.promo.gorrerolicor.online',
        'gorrerolicor.online',
      ),
    ).toBe(false);
  });

  it('returns provider-safe DNS host values for root onboarding', () => {
    const payload = buildDomainRootDnsInstructions({
      root: {
        id: 1,
        hostname: 'gorrerolicor.online',
        status: 'issuing_certificate',
        ssl_status: 'pending',
        verification_token: 'vdx_test',
        config: {
          ssl: {
            validation_records: [
              {
                domain_name: 'gorrerolicor.online',
                record_type: 'CNAME',
                name: '_abc.gorrerolicor.online.',
                value: '_xyz.acm-validations.aws.',
              },
            ],
          },
        },
      },
      routingEndpoint: 'd123.cloudfront.net',
      verificationToken: 'vdx_test',
    });

    expect(payload.instructions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          group: 'certificate',
          provider_host: '_abc',
          fqdn_name: '_abc.gorrerolicor.online',
          value: '_xyz.acm-validations.aws',
        }),
        expect.objectContaining({
          group: 'routing',
          provider_host: '@',
          value: 'd123.cloudfront.net',
        }),
        expect.objectContaining({
          group: 'routing',
          provider_host: '*',
          value: 'd123.cloudfront.net',
        }),
      ]),
    );
  });

  it('keeps ownership pending and re-exposes the TXT when ownership failed', () => {
    const payload = buildDomainRootDnsInstructions({
      root: {
        id: 1,
        hostname: 'gorrerolicor.online',
        status: 'failed_ownership',
        ssl_status: 'pending',
        last_verified_at: null,
        verification_token: 'vdx_test',
      },
      routingEndpoint: 'd123.cloudfront.net',
      verificationToken: 'vdx_test',
    });

    expect(payload.ownership_status).toBe('pending');
    expect(
      payload.stages?.find((stage) => stage.key === 'ownership')?.status,
    ).toBe('failed');
    expect(payload.instructions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          group: 'ownership',
          record_type: 'TXT',
          provider_host: '_vendix-verify',
          value: 'vdx_test',
        }),
      ]),
    );
  });
});
