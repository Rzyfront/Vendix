import { Module } from '@nestjs/common';
import { ResponseService } from './response.service';
import { ResponseInterceptor } from './response.interceptor';

/**
 * Módulo de respuestas estandarizadas
 *
 * Proporciona:
 * - ResponseService: Servicio para crear respuestas consistentes
 * - ResponseInterceptor: Interceptor para establecer códigos HTTP en headers
 */
@Module({
  providers: [ResponseService, ResponseInterceptor],
  exports: [ResponseService, ResponseInterceptor],
})
export class ResponseModule {}
