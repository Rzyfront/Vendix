import { Controller, Get, UseGuards, Logger } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrenciesService } from './currencies.service';
import { ResponseService } from '../../../common/responses/response.service';

/**
 * 🌐 Public Currencies Controller
 *
 * Handles public currency endpoints that are accessible to authenticated users.
 * Unlike the super-admin currencies controller, this endpoint doesn't require
 * SUPER_ADMIN role - any authenticated user can access active currencies.
 *
 * Routes (with /public prefix):
 * - GET /public/currencies/active
 *
 * @controller PublicCurrenciesController
 */
@Controller('public/currencies')
@UseGuards(JwtAuthGuard) // Requires authentication, but no role restriction
export class PublicCurrenciesController {
  private readonly logger = new Logger(PublicCurrenciesController.name);

  constructor(
    private readonly currenciesService: CurrenciesService,
    private readonly responseService: ResponseService,
  ) {}

  /**
   * 🌐 Obtiene las monedas activas del sistema
   *
   * Este endpoint está disponible para cualquier usuario autenticado.
   * Retorna solo las monedas con estado 'active' para uso en selectores
   * de configuración de tiendas y otros módulos del sistema.
   *
   * @returns Lista de monedas activas con sus propiedades básicas
   */
  @Get('active')
  async getActiveCurrencies() {
    this.logger.log('🔍 Fetching active currencies for authenticated user');

    return await this.currenciesService.getActiveCurrencies();
  }
}
