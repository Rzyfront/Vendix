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
});
