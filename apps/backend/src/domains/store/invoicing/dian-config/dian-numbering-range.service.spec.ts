import { DianNumberingRangeService } from './dian-numbering-range.service';

jest.mock('../providers/dian-direct/dian-numbering-range.parser', () => ({
  parseNumberingRangeResponse: jest.fn(),
}));
import { parseNumberingRangeResponse } from '../providers/dian-direct/dian-numbering-range.parser';

const RANGE = {
  resolution_number: '18760000001',
  prefix: 'SETP',
  range_from: 1,
  range_to: 100,
  valid_from: '2026-01-01T00:00:00.000Z',
  valid_to: '2027-01-01T00:00:00.000Z',
  resolution_date: '2026-01-01T00:00:00.000Z',
  technical_key: null,
};

const ARCHIVED_AT = new Date('2026-05-01T10:00:00.000Z');

function row(archived_at: Date | null) {
  return {
    id: 7,
    prefix: 'SETP',
    resolution_number: '18760000001',
    resolution_date: new Date('2026-01-01T00:00:00.000Z'),
    range_from: 1,
    range_to: 100,
    current_number: 5,
    valid_from: new Date('2026-01-01T00:00:00.000Z'),
    valid_to: new Date('2027-01-01T00:00:00.000Z'),
    is_active: true,
    document_type: 'invoice',
    archived_at,
    technical_key: null,
    technical_key_encrypted: null,
    technical_key_fingerprint: null,
  };
}

describe('DianNumberingRangeService — resoluciones archivadas', () => {
  let service: DianNumberingRangeService;
  let prisma: any;
  let dian: any;

  beforeEach(() => {
    (parseNumberingRangeResponse as jest.Mock).mockReturnValue({
      ranges: [RANGE],
      element_names: [],
      outcome: 'ranges',
      operation_code: null,
      operation_description: null,
    });
    prisma = {
      invoice_resolutions: {
        findMany: jest.fn().mockResolvedValue([row(ARCHIVED_AT)]),
        update: jest.fn(),
        create: jest.fn(),
      },
    };
    dian = {
      queryNumberingRange: jest.fn().mockResolvedValue({
        raw_response: '<x/>',
        nit: '900',
        software_id: 's',
        dian_configuration_id: 1,
        accounting_entity_id: 3,
        environment: 'production',
        config_environment: 'production',
        queried_at: new Date().toISOString(),
      }),
      getConfigById: jest
        .fn()
        .mockResolvedValue({ organization_id: 1, store_id: 1 }),
    };
    service = new DianNumberingRangeService(prisma, dian, {} as any);
  });

  it('empareja un rango con la fila archivada y expone archived_at en ISO', async () => {
    const report = await service.queryRanges(1);

    expect(report.ranges).toHaveLength(1);
    expect(report.ranges[0].local?.id).toBe(7);
    expect(report.ranges[0].local?.archived_at).toBe(ARCHIVED_AT.toISOString());
    expect(report.local_only).toHaveLength(0);
  });

  it('aplicar sobre una fila archivada falla con INVOICING_RESOLUTION_016 sin escribir', async () => {
    const result = await service.applyRanges(1, {
      ranges: [{ resolution_number: '18760000001', prefix: 'SETP' }],
    } as any);

    expect(result.failed).toBe(1);
    expect(result.results[0].ok).toBe(false);
    expect(result.results[0].error?.code).toBe('INVOICING_RESOLUTION_016');
    expect(prisma.invoice_resolutions.update).not.toHaveBeenCalled();
    expect(prisma.invoice_resolutions.create).not.toHaveBeenCalled();
  });
});
