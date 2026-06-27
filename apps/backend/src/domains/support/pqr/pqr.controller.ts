import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { Public } from '../../../common/decorators/public.decorator';
import { CreatePqrPublicDto } from './dto/create-pqr-public.dto';
import { PqrService } from './pqr.service';

/**
 * Public PQR endpoint.
 *
 * - `@Public()` so anyone can submit or track a PQR without auth.
 * - POST is rate-limited per IP (20/min) via the global ThrottlerGuard.
 *   GET tracking is throttled separately to limit enumeration attempts.
 * - Returns minimal payload so the frontend can navigate to a thank-you page.
 */
@Controller('pqr')
export class PqrController {
  constructor(private readonly pqrService: PqrService) {}

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post()
  async create(@Body() dto: CreatePqrPublicDto, @Req() req: Request) {
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.ip ||
      req.socket?.remoteAddress ||
      'unknown';

    // The DomainResolverMiddleware already mapped the incoming hostname
    // (e.g. nike.vendix.com) to its store + org via the public_domains
    // table. Use that as a fallback so anonymous PQRs submitted from a
    // storefront are correctly tagged with the source tienda — without
    // this, the PQR would land under the platform org with store_id =
    // null and the org-admin "Tienda" filter would silently skip it.
    // Authenticated callers can still override by passing
    // `organization_id` / `store_id` explicitly in the DTO.
    const domainContext = req['domain_context'] as
      | { store_id?: number; organization_id?: number }
      | undefined;
    const enrichedDto = {
      ...dto,
      store_id: dto.store_id ?? domainContext?.store_id,
      organization_id: dto.organization_id ?? domainContext?.organization_id,
    };

    const ticket = await this.pqrService.createPublic(enrichedDto, ip);

    return {
      success: true,
      data: {
        id: ticket.id,
        ticket_number: ticket.ticket_number,
        message:
          'Hemos recibido tu PQR. Te responderemos pronto a ' + dto.email + '.',
      },
    };
  }

  /**
   * Public tracking endpoint. Returns a sanitized view of a PQR for the
   * anonymous requester who knows the ticket_number. Throttled per IP.
   */
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get(':ticket_number')
  async track(@Param('ticket_number') ticketNumber: string) {
    const data = await this.pqrService.findByTicketNumberPublic(ticketNumber);
    return { success: true, data };
  }
}