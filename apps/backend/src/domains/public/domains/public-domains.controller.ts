import {
  Controller,
  Get,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Public } from '../../auth/decorators/public.decorator';
import { ResponseService, SuccessResponse } from '@common/responses';
import { PublicDomainsService } from './public-domains.service';
import {
  DomainResolutionResponse,
  DomainAvailabilityResponse,
} from '../../organization/domains/types/domain.types';

/**
 * 🌐 Public Domains Controller
 *
 * Handles public domain resolution endpoints that are accessible
 * without authentication. These endpoints are used by the frontend
 * to resolve domain configurations for all visitors.
 *
 * Routes (with /public prefix):
 * - GET /public/domains/resolve/:hostname
 * - GET /public/domains/check/:hostname
 */
@Controller('public/domains')
export class PublicDomainsController {
  private readonly logger = new Logger(PublicDomainsController.name);

  constructor(
    private readonly publicDomainsService: PublicDomainsService,
    private readonly responseService: ResponseService,
  ) {}

  /**
   * 🌐 Resuelve la configuración de un dominio específico (PÚBLICO)
   *
   * Este endpoint es utilizado por el frontend para resolver la configuración
   * de un dominio cuando un usuario visita la aplicación.
   *
   * @param hostname - El hostname a resolver (ej: "tienda.vendix.com")
   * @param subdomain - Subdominio opcional
   * @returns Configuración del dominio resuelto
   */
  @Public()
  @Get('resolve/:hostname')
  @HttpCode(HttpStatus.OK)
  async resolveDomain(
    @Param('hostname') hostname: string,
    @Query('subdomain') subdomain?: string,
  ): Promise<SuccessResponse<DomainResolutionResponse>> {
    this.logger.log(`🔍 Public domain resolution request: ${hostname}`);

    const result = await this.publicDomainsService.resolveDomain(
      hostname,
      subdomain,
    );

    return this.responseService.success(result, 'Domain resolved successfully');
  }

  /**
   * 🔍 Verificar disponibilidad de hostname (PÚBLICO)
   *
   * Permite verificar si un hostname está disponible antes de intentar
   * registrarlo. Útil para validación en tiempo real en formularios.
   *
   * @param hostname - El hostname a verificar
   * @returns Información sobre disponibilidad del hostname
   */
  @Public()
  @Get('check/:hostname')
  @HttpCode(HttpStatus.OK)
  async checkHostnameAvailability(
    @Param('hostname') hostname: string,
  ): Promise<SuccessResponse<DomainAvailabilityResponse>> {
    this.logger.log(`🔍 Hostname availability check: ${hostname}`);

    const result =
      await this.publicDomainsService.checkHostnameAvailability(hostname);

    return this.responseService.success(
      result,
      'Hostname availability checked successfully',
    );
  }
}
