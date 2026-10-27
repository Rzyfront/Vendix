import { Controller, Get, Param, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { Public } from '../../../../../common/decorators/public.decorator';
import { LodgingIcalExportService } from './ical-export.service';

/**
 * Hospitality Suite (H6.1) — public iCal feed of one room, polled by
 * Airbnb/Booking. The secret token in the URL is the only credential; an
 * unknown or revoked token answers 404. Dates only, no personal data.
 *
 * Route: GET /api/public/hospitality/ical/:token.ics
 */
@Controller('public/hospitality/ical')
export class PublicLodgingIcalController {
  constructor(private readonly icalExport: LodgingIcalExportService) {}

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @Get(':file')
  async feed(@Param('file') file: string, @Res() res: Response) {
    const body = await this.icalExport.renderFeed(file.replace(/\.ics$/, ''));
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="calendar.ics"');
    res.send(body);
  }
}
