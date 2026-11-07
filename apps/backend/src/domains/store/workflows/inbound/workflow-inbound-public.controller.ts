import { Controller, Header, HttpCode, HttpStatus, Param, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Public } from '@common/decorators/public.decorator';
import { ResponseService } from '@common/responses/response.service';
import { WorkflowInboundReceiverService } from './workflow-inbound-receiver.service';

interface InboundRequest extends Request {
  /** Set by the global JSON parser: the exact body bytes as UTF-8. */
  rawBody?: string;
}

/**
 * `POST /api/public/workflows/hooks/:publicId`: starts a flow from another
 * system. No user session: the signature over the raw body is the credential.
 */
@Controller('public/workflows/hooks')
export class WorkflowInboundPublicController {
  constructor(
    private readonly receiver: WorkflowInboundReceiverService,
    private readonly responseService: ResponseService,
  ) {}

  @Public()
  @Post(':publicId')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  async receive(
    @Param('publicId') publicId: string,
    @Req() request: InboundRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.receiver.receive(publicId, {
      rawBody: typeof request.rawBody === 'string' ? request.rawBody : '',
      timestamp: request.headers['x-vendix-timestamp'],
      signature: request.headers['x-vendix-signature'],
      idempotencyKey: request.headers['idempotency-key'],
    });
    // A repeated Idempotency-Key answers the original reference with 200.
    if (result.replayed) response.status(HttpStatus.OK);
    return this.responseService.success({
      reference: result.reference,
      instance_id: result.instance_id,
    });
  }
}
