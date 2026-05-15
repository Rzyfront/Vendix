import { DomainProvisioningService } from './domain-provisioning.service';

describe('DomainProvisioningService', () => {
  const rootDomain = {
    id: 10,
    hostname: 'example.com',
    organization_id: 1,
    store_id: 2,
    ownership: 'custom_domain',
    status: 'pending_certificate',
    ssl_status: 'pending',
    last_verified_at: new Date('2026-01-01T00:00:00Z'),
    verification_token: 'vdx_token',
    acm_certificate_arn: null,
    certificate_requested_at: null,
    certificate_issued_at: null,
    cert_expires_at: null,
    validation_cname_name: null,
    validation_cname_value: null,
    config: {},
    app_type: 'STORE_ECOMMERCE',
  };

  function createService(overrides?: {
    findUnique?: jest.Mock;
    update?: jest.Mock;
    getConfig?: jest.Mock;
  }) {
    const prisma = {
      domain_settings: {
        findUnique: overrides?.findUnique ?? jest.fn(),
        update: overrides?.update ?? jest.fn(),
        updateMany: jest.fn(),
      },
    } as any;
    const acm = {
      requestCertificate: jest.fn(),
      describeCertificate: jest.fn(),
    } as any;
    const cloudFront = {
      getDistributionConfig: jest.fn(),
      addAliasesToDistribution: jest.fn(),
      getDistribution: jest.fn().mockResolvedValue({
        status: 'Deployed',
        domainName: 'd123.cloudfront.net',
        aliases: [],
      }),
    } as any;
    const config = {
      get: overrides?.getConfig ?? jest.fn((key: string) => {
        if (key === 'CLOUDFRONT_DISTRIBUTION_ID') return 'DIST123';
        return undefined;
      }),
    } as any;
    const events = { emit: jest.fn() } as any;

    const service = new DomainProvisioningService(
      prisma,
      acm,
      cloudFront,
      config,
      events,
    );

    return { service, prisma, acm, cloudFront, config, events };
  }

  it('requests root certificates with a wildcard SAN', async () => {
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce(rootDomain)
      .mockResolvedValueOnce({
        ...rootDomain,
        acm_certificate_arn: 'arn:aws:acm:cert/root',
        status: 'issuing_certificate',
      });
    const update = jest.fn().mockImplementation(({ data }) =>
      Promise.resolve({
        ...rootDomain,
        ...data,
        acm_certificate_arn: data.acm_certificate_arn ?? 'arn:aws:acm:cert/root',
      }),
    );
    const { service, acm } = createService({ findUnique, update });

    acm.requestCertificate.mockResolvedValue({
      certificateArn: 'arn:aws:acm:cert/root',
    });
    acm.describeCertificate.mockResolvedValue({
      status: 'PENDING_VALIDATION',
      domainValidationOptions: [],
    });

    await service.startCertificateProvisioning(rootDomain.id);

    expect(acm.requestCertificate).toHaveBeenCalledWith(
      expect.objectContaining({
        domainName: 'example.com',
        subjectAlternativeNames: ['*.example.com'],
      }),
    );
  });

  it('stores all ACM validation CNAMEs and mirrors the first legacy field', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      ...rootDomain,
      acm_certificate_arn: 'arn:aws:acm:cert/root',
    });
    const update = jest.fn().mockImplementation(({ data }) =>
      Promise.resolve({
        ...rootDomain,
        ...data,
      }),
    );
    const { service, acm, prisma } = createService({ findUnique, update });

    acm.describeCertificate.mockResolvedValue({
      status: 'ISSUED',
      notAfter: new Date('2027-01-01T00:00:00Z'),
      domainValidationOptions: [
        {
          domainName: 'example.com',
          validationStatus: 'SUCCESS',
          resourceRecord: {
            type: 'CNAME',
            name: '_root.example.com.',
            value: '_root.acm-validations.aws.',
          },
        },
        {
          domainName: '*.example.com',
          validationStatus: 'SUCCESS',
          resourceRecord: {
            type: 'CNAME',
            name: '_wild.example.com.',
            value: '_wild.acm-validations.aws.',
          },
        },
      ],
    });

    await service.refreshCertificateStatus(rootDomain.id);

    expect(prisma.domain_settings.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'pending_alias',
          ssl_status: 'issued',
          validation_cname_name: '_root.example.com.',
          validation_cname_value: '_root.acm-validations.aws.',
          config: expect.objectContaining({
            ssl: expect.objectContaining({
              wildcard_status: 'issued',
              validation_records: expect.arrayContaining([
                expect.objectContaining({
                  domain_name: 'example.com',
                  name: '_root.example.com.',
                }),
                expect.objectContaining({
                  domain_name: '*.example.com',
                  name: '_wild.example.com.',
                }),
              ]),
            }),
          }),
        }),
      }),
    );
  });

  it('adds both apex and wildcard CloudFront aliases for root domains', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      ...rootDomain,
      acm_certificate_arn: 'arn:aws:acm:cert/root',
      status: 'pending_alias',
      ssl_status: 'issued',
    });
    const update = jest.fn().mockImplementation(({ data }) =>
      Promise.resolve({
        ...rootDomain,
        ...data,
      }),
    );
    const { service, cloudFront } = createService({ findUnique, update });

    cloudFront.getDistributionConfig.mockResolvedValue({
      config: {
        Aliases: { Quantity: 0, Items: [] },
        ViewerCertificate: {},
      },
      etag: 'etag-1',
    });
    cloudFront.addAliasesToDistribution.mockResolvedValue({ etag: 'etag-2' });

    await service.attachCloudFrontAlias(rootDomain.id);

    expect(cloudFront.addAliasesToDistribution).toHaveBeenCalledWith({
      distributionId: 'DIST123',
      aliasesToAdd: ['example.com', '*.example.com'],
      acmCertificateArn: 'arn:aws:acm:cert/root',
    });
  });

  it('does not mark active until the HTTPS probe passes', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      ...rootDomain,
      acm_certificate_arn: 'arn:aws:acm:cert/root',
      status: 'propagating',
      ssl_status: 'issued',
      cloudfront_distribution_id: 'DIST123',
    });
    const update = jest.fn().mockImplementation(({ data }) =>
      Promise.resolve({
        ...rootDomain,
        ...data,
      }),
    );
    const { service, cloudFront, prisma, events } = createService({
      findUnique,
      update,
    });
    cloudFront.getDistribution.mockResolvedValue({
      status: 'Deployed',
      domainName: 'd123.cloudfront.net',
      aliases: ['example.com', '*.example.com'],
    });
    jest
      .spyOn(service as any, 'httpsHead')
      .mockRejectedValue(new Error('handshake failure'));

    await service.refreshCloudFrontStatus(rootDomain.id);

    expect(prisma.domain_settings.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'propagating',
          config: expect.objectContaining({
            ssl: expect.objectContaining({
              cloudfront_status: 'Deployed',
              https_probe_status: 'failed',
              routing_target: 'd123.cloudfront.net',
            }),
          }),
        }),
      }),
    );
    expect(events.emit).not.toHaveBeenCalledWith(
      'domain.activated',
      expect.anything(),
    );
  });
});
