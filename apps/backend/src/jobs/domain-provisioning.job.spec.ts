import { DomainProvisioningJob } from './domain-provisioning.job';

describe('DomainProvisioningJob', () => {
  it('advances verified domains that are waiting for provisioning', async () => {
    const domains = [
      { id: 1, hostname: 'example.com', status: 'pending_certificate' },
      { id: 2, hostname: 'shop.example.com', status: 'propagating' },
    ];
    const prisma = {
      domain_roots: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
      domain_settings: {
        findMany: jest.fn().mockResolvedValue(domains),
        update: jest.fn(),
      },
    } as any;
    const domainProvisioning = {
      provisionNext: jest.fn().mockResolvedValue({}),
    } as any;
    const domainRootProvisioning = {
      provisionNext: jest.fn().mockResolvedValue({}),
    } as any;
    const job = new DomainProvisioningJob(
      prisma,
      domainProvisioning,
      domainRootProvisioning,
    );

    await job.handleDomainProvisioningQueue();

    expect(prisma.domain_settings.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          ownership: { in: ['custom_domain', 'custom_subdomain'] },
          last_verified_at: { not: null },
        }),
        take: 25,
      }),
    );
    expect(domainProvisioning.provisionNext).toHaveBeenCalledTimes(2);
    expect(domainProvisioning.provisionNext).toHaveBeenCalledWith(1);
    expect(domainProvisioning.provisionNext).toHaveBeenCalledWith(2);
    expect(domainRootProvisioning.provisionNext).not.toHaveBeenCalled();
  });
});
