import {
  Controller, Get, Header, HttpException, Param, Res, Sse,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { Observable } from 'rxjs';
import { Public } from '../../../common/decorators/public.decorator';
import { RequestContextService } from '../../../common/context/request-context.service';
import { ServiceSessionAccessService } from './service-session-access.service';

@Controller('ecommerce/service-sessions')
@Public()
export class ServiceSessionAccessController {
  constructor(private readonly access: ServiceSessionAccessService) {}

  @Get(':token')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  async progress(@Param('token') token: string, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    try {
      return await this.access.getPublicProgress(token);
    } catch (error: any) {
      if (!(error instanceof HttpException)) throw error;
      throw new HttpException(
        { statusCode: error.getStatus(), error_code: error.getStatus() === 429 ? 'SERVICE_QR_002' : 'SERVICE_QR_001', message: error.getStatus() === 429 ? 'Too many progress connections' : 'Access link unavailable' },
        error.getStatus(),
      );
    }
  }

  @Get('station/:publicId')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  async station(@Param('publicId') publicId: string) {
    return this.access.getPublicStation(publicId);
  }

  @Sse(':token/stream')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  stream(@Param('token') token: string, @Res({ passthrough: true }) response: Response): Observable<any> {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    const context = RequestContextService.getContext();
    if (!context?.store_id) {
      throw new HttpException({ statusCode: 410, error_code: 'SERVICE_QR_001', message: 'Access link unavailable' }, 410);
    }
    return this.access.streamPublicProgress(token, context);
  }
}
