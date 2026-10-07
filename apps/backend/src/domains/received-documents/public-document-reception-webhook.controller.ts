import {
  BadRequestException,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { ResponseService } from '../../common/responses/response.service';
import { DocumentReceptionSyncQueueService } from './services/document-reception-sync-queue.service';
import { DocumentReceptionWebhookService } from './services/document-reception-webhook.service';

interface ReceptionWebhookRequest extends Request {
  rawReceptionBody?: Buffer;
}

@Controller('public/received-documents/webhook')
export class PublicDocumentReceptionWebhookController {
  constructor(
    private readonly webhook: DocumentReceptionWebhookService,
    private readonly syncQueue: DocumentReceptionSyncQueueService,
    private readonly response: ResponseService,
  ) {}

  @Public()
  @Post(':publicToken')
  @HttpCode(HttpStatus.ACCEPTED)
  async receive(
    @Param('publicToken') publicToken: string,
    @Req() request: ReceptionWebhookRequest,
  ) {
    const rawBody = request?.rawReceptionBody;
    if (!Buffer.isBuffer(rawBody) || rawBody.length < 1) {
      throw new BadRequestException('Webhook raw payload is required.');
    }

    const headers = {
      timestamp: request.headers?.['x-vendix-timestamp'] as string,
      event_id: request.headers?.['x-vendix-event-id'] as string,
      signature: request.headers?.['x-vendix-signature'] as string,
    };
    const claim = await this.webhook.accept(publicToken, headers, rawBody);
    let queued = true;
    try {
      await this.syncQueue.enqueue(claim.run_id);
    } catch {
      // The durable run remains recoverable by the scheduler/outbox sweeper.
      queued = false;
    }

    return this.response.success(
      { run_id: claim.run_id, duplicate: claim.duplicate, queued },
      'Webhook received',
    );
  }
}
