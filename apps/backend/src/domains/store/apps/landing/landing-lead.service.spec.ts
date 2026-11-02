import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes } from '@common/errors/error-codes';
import { LandingLeadService } from './landing-lead.service';
import { LandingLeadDto } from './landing-page.dto';

/**
 * Apps · landing page leads (Fase 6, D12). The customer handling is the CRM
 * contact flow (doubled here); what this spec pins is that the lead reaches
 * the pipeline with origin, offer and date, in the CRM tables that exist.
 */
describe('LandingLeadService', () => {
  const STORE_ID = 10;
  const dto: LandingLeadDto = {
    first_name: 'Ana',
    email: 'ana@example.com',
    message: 'Quiero el combo de la promo',
  };

  let appRow: any;
  let landingContent: any;
  let product: any;
  let notes: any[];
  let opportunities: any[];
  let stages: any[];
  let crmPublic: { submitContact: jest.Mock };
  let bootstrap: { ensureDefaultCrmPipeline: jest.Mock };
  let service: LandingLeadService;

  beforeEach(() => {
    jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(STORE_ID);
    appRow = {
      config: {
        offer_mode: 'product',
        offer_title: 'Combo de lanzamiento',
        offer_product_id: 7,
      },
      domain_settings: { hostname: 'Roku-Landing.vendix.online', status: 'active' },
    };
    landingContent = { enabled: true, published_json: { blocks: [] } };
    product = { id: 7, slug: 'combo', name: 'Combo familiar' };
    notes = [];
    opportunities = [];
    stages = [
      { id: 31, pipeline_id: 3, kind: 'open', is_active: true, sort_order: 0 },
    ];

    const globalPrisma = {
      store_apps: { findFirst: jest.fn(async () => appRow) },
      crm_landing_pages: { findFirst: jest.fn(async () => landingContent) },
      products: { findFirst: jest.fn(async () => product) },
    };
    const prisma = {
      crm_notes: {
        create: jest.fn(async ({ data }: any) => {
          notes.push(data);
          return { id: notes.length, ...data };
        }),
      },
      crm_pipeline_stages: {
        findFirst: jest.fn(
          async ({ where }: any) =>
            stages.find(
              (s) =>
                s.pipeline_id === where.pipeline_id &&
                s.kind === where.kind &&
                s.is_active === where.is_active,
            ) ?? null,
        ),
      },
      crm_opportunities: {
        findFirst: jest.fn(async ({ where }: any) => {
          if (where.stage_id !== undefined) {
            const inStage = opportunities.filter((o) => o.stage_id === where.stage_id);
            return inStage.length
              ? { sort_order: Math.max(...inStage.map((o) => o.sort_order)) }
              : null;
          }
          return (
            opportunities.find(
              (o) =>
                o.customer_id === where.customer_id &&
                o.pipeline_id === where.pipeline_id &&
                o.status === where.status &&
                o.title === where.title,
            ) ?? null
          );
        }),
        create: jest.fn(async ({ data }: any) => {
          const created = { id: 100 + opportunities.length, ...data };
          opportunities.push(created);
          return { id: created.id };
        }),
      },
    };
    crmPublic = {
      submitContact: jest
        .fn()
        .mockResolvedValue({ customer_created: true, customer_id: 55 }),
    };
    bootstrap = {
      ensureDefaultCrmPipeline: jest.fn().mockResolvedValue({ id: 3 }),
    };
    service = new LandingLeadService(
      prisma as any,
      globalPrisma as any,
      crmPublic as any,
      bootstrap as any,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('creates or reuses the customer through the CRM contact flow and opens a pipeline card', async () => {
    const result = await service.submitLead(dto);

    expect(crmPublic.submitContact).toHaveBeenCalledWith(dto);
    expect(result).toEqual({
      customer_created: true,
      customer_id: 55,
      opportunity_id: 100,
    });
    expect(opportunities).toEqual([
      expect.objectContaining({
        store_id: STORE_ID,
        customer_id: 55,
        pipeline_id: 3,
        stage_id: 31,
        status: 'open',
        owner_user_id: null,
        title: 'Landing page · Combo de lanzamiento',
        sort_order: 0,
      }),
    ]);
  });

  it('keeps origin, offer and date in a CRM note of the customer', async () => {
    const before = Date.now();
    await service.submitLead(dto);

    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ store_id: STORE_ID, customer_id: 55 });
    const body: string = notes[0].body;
    expect(body).toContain('Origen: Landing page (https://roku-landing.vendix.online)');
    expect(body).toContain('Oferta: Combo de lanzamiento (con producto)');
    expect(body).toContain('Producto: Combo familiar (#7)');
    expect(body).toContain('Mensaje: Quiero el combo de la promo');
    const date = /Fecha: (\S+)/.exec(body)![1];
    expect(new Date(date).getTime()).toBeGreaterThanOrEqual(before - 1);
  });

  it('a second submission of the same offer adds a note but keeps one card', async () => {
    await service.submitLead(dto);
    const again = await service.submitLead(dto);

    expect(opportunities).toHaveLength(1);
    expect(again.opportunity_id).toBe(100);
    expect(notes).toHaveLength(2);
  });

  it('an informative offer is labelled as such', async () => {
    appRow.config = { offer_mode: 'info', offer_title: 'Asesoría gratis' };

    await service.submitLead(dto);

    expect(opportunities[0].title).toBe('Landing page · Asesoría gratis');
    expect(notes[0].body).toContain('Oferta: Asesoría gratis (informativa)');
    expect(notes[0].body).not.toContain('Producto:');
  });

  it('without the landing published on its own domain the lead is refused and nothing is created', async () => {
    appRow = null;

    await expect(service.submitLead(dto)).rejects.toMatchObject({
      errorCode: ErrorCodes.STORE_APPS_001.code,
    });
    expect(crmPublic.submitContact).not.toHaveBeenCalled();
    expect(notes).toHaveLength(0);
    expect(opportunities).toHaveLength(0);
  });

  it('a failure saving the context still answers the visitor with the customer', async () => {
    bootstrap.ensureDefaultCrmPipeline.mockRejectedValue(new Error('db down'));

    const result = await service.submitLead(dto);

    expect(result).toEqual({
      customer_created: true,
      customer_id: 55,
      opportunity_id: null,
    });
    expect(notes).toHaveLength(1);
  });

  it('a pipeline with no open stage keeps the note without a card', async () => {
    stages = [];

    const result = await service.submitLead(dto);

    expect(result.opportunity_id).toBeNull();
    expect(notes).toHaveLength(1);
    expect(opportunities).toHaveLength(0);
  });
});
