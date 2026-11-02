import { Injectable, Logger } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors/vendix-http.exception';
import { ErrorCodes } from '@common/errors/error-codes';
import { StoreBootstrapHelper } from '@common/helpers/store-bootstrap.helper';
import { CrmPublicService } from '../../crm/services/crm-public.service';
import {
  PublishedLandingPage,
  readPublishedLandingPage,
} from './landing-page.reader';
import { buildLeadNote, buildLeadTitle } from './landing-lead';
import { LandingLeadDto } from './landing-page.dto';

export interface LandingLeadResult {
  customer_created: boolean;
  customer_id: number | null;
  /** Pipeline card of the lead; `null` when the context could not be saved. */
  opportunity_id: number | null;
}

/**
 * Lead of the landing published on its own domain (Fase 6, D12).
 *
 * The customer is created or reused exactly like `POST ecommerce/crm/contact`
 * (`CrmPublicService.submitContact`: same gates, dedupe and owner
 * notification). Then the lead enters the CRM with its context, in the tables
 * the CRM already has: an open opportunity in the first stage of the store's
 * default pipeline (titled with origin and offer, one per customer and offer)
 * and a CRM note with origin, offer and date. No CRM screen changes.
 */
@Injectable()
export class LandingLeadService {
  private readonly logger = new Logger(LandingLeadService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly globalPrisma: GlobalPrismaService,
    private readonly crmPublic: CrmPublicService,
    private readonly bootstrap: StoreBootstrapHelper,
  ) {}

  /** Public offer of the landing; `null` when it is not on its own domain. */
  async getPublished(): Promise<PublishedLandingPage | null> {
    return readPublishedLandingPage(this.globalPrisma, this.requireStoreId());
  }

  async submitLead(dto: LandingLeadDto): Promise<LandingLeadResult> {
    const storeId = this.requireStoreId();
    const page = await readPublishedLandingPage(this.globalPrisma, storeId);
    if (!page) throw new VendixHttpException(ErrorCodes.STORE_APPS_001);

    const contact = await this.crmPublic.submitContact(dto);
    if (!contact.customer_id) {
      return { ...contact, opportunity_id: null };
    }

    // The customer exists and the owner was notified: a failure here must
    // not turn the visitor's submission into an error they retry (and so
    // duplicate). It is logged with the store and customer to reconcile.
    let opportunityId: number | null = null;
    try {
      opportunityId = await this.recordContext(
        storeId,
        contact.customer_id,
        page,
        dto.message,
      );
    } catch (err: unknown) {
      this.logger.error(
        `[LandingLead] context not saved for store ${storeId}, customer ${contact.customer_id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    return { ...contact, opportunity_id: opportunityId };
  }

  private async recordContext(
    storeId: number,
    customerId: number,
    page: PublishedLandingPage,
    message: string,
  ): Promise<number | null> {
    const receivedAt = new Date();
    await this.prisma.crm_notes.create({
      data: {
        store_id: storeId,
        customer_id: customerId,
        body: buildLeadNote({
          hostname: page.hostname,
          offer: page.offer,
          message,
          receivedAt,
        }),
      },
    });

    const pipeline = await this.bootstrap.ensureDefaultCrmPipeline({
      store_id: storeId,
    });
    const stage = await this.prisma.crm_pipeline_stages.findFirst({
      where: { pipeline_id: pipeline.id, is_active: true, kind: 'open' },
      orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    if (!stage) {
      this.logger.warn(
        `[LandingLead] store ${storeId} pipeline ${pipeline.id} has no open stage; note saved without card`,
      );
      return null;
    }

    const title = buildLeadTitle(page.offer);
    // A repeated submission for the same offer keeps one card; the note above
    // records the new contact.
    const existing = await this.prisma.crm_opportunities.findFirst({
      where: {
        customer_id: customerId,
        pipeline_id: pipeline.id,
        status: 'open',
        title,
      },
      select: { id: true },
    });
    if (existing) return existing.id;

    const last = await this.prisma.crm_opportunities.findFirst({
      where: { stage_id: stage.id },
      orderBy: { sort_order: 'desc' },
      select: { sort_order: true },
    });
    const created = await this.prisma.crm_opportunities.create({
      data: {
        store_id: storeId,
        customer_id: customerId,
        pipeline_id: pipeline.id,
        stage_id: stage.id,
        title,
        status: 'open',
        owner_user_id: null,
        sort_order: last ? last.sort_order + 1 : 0,
      },
      select: { id: true },
    });
    return created.id;
  }

  private requireStoreId(): number {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.SYS_FORBIDDEN_001);
    }
    return storeId;
  }
}
