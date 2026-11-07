import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { storeAllowsFlows } from '../../workflows/engine/workflow-industry';
import { SignatureRequestsService } from './signature-requests.service';
import { OPEN_REQUEST_STATUSES } from './signature.constants';

/**
 * Closes the signature requests whose link life is over (`expired`) and
 * retries the seal of those whose signers all signed but the seal failed.
 * One store at a time; one failing store never stops the rest.
 */
@Injectable()
export class SignatureExpiryCron {
  private readonly logger = new Logger(SignatureExpiryCron.name);
  private running = false;

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly requests: SignatureRequestsService,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async handle(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.runOnce(new Date());
    } catch (e) {
      this.logger.error(`Signature expiry failed: ${(e as Error)?.message}`);
    } finally {
      this.running = false;
    }
  }

  /** Returns how many requests were expired and how many were sealed. */
  async runOnce(now: Date): Promise<{ expired: number; sealed: number }> {
    const rows: Array<{ store_id: number; organization_id: number }> = await this.prisma
      .withoutScope()
      .signature_requests.findMany({
        where: {
          OR: [
            { status: { in: [...OPEN_REQUEST_STATUSES] }, expires_at: { lte: now } },
            { status: 'partially_signed' },
          ],
        },
        select: { store_id: true, organization_id: true },
        take: 1000,
      });
    const stores = new Map<number, number>();
    for (const r of rows) stores.set(r.store_id, r.organization_id);

    let expired = 0;
    let sealed = 0;
    for (const [storeId, organizationId] of stores) {
      try {
        if (!(await storeAllowsFlows(this.prisma.withoutScope() as never, storeId))) continue;
        await RequestContextService.runIsolated(
          { store_id: storeId, organization_id: organizationId, is_super_admin: false, is_owner: false },
          async () => {
            expired += await this.requests.expireDue(now);
            sealed += await this.requests.sealPending();
          },
        );
      } catch (e) {
        this.logger.warn(`Signature upkeep of store ${storeId} failed: ${(e as Error)?.message}`);
      }
    }
    return { expired, sealed };
  }
}
