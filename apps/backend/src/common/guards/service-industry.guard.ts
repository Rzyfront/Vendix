import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import { ErrorCodes, VendixHttpException } from '../errors';
import { storeSupportsServiceStations } from '../helpers/industry-capabilities.helper';

/**
 * Puerta por industria de Estaciones de servicio (estaciones, atenciones y su
 * cuenta). El menú ya las oculta a tiendas sin la industria `service`, pero eso
 * es solo UX: sin este guard una tienda retail podía crear estaciones con
 * curl/Postman. Responde 403 `STATION_INDUSTRY_001`.
 *
 * Mismo patrón que `ConstructionIndustryGuard`: OR multi-industria, y deja pasar
 * sin `store_id` o con tienda inexistente (esos errores son de otras capas).
 * Usa `GlobalPrismaService` porque corre antes del contexto por petición.
 */
@Injectable()
export class ServiceIndustryGuard implements CanActivate {
  private readonly logger = new Logger(ServiceIndustryGuard.name);

  constructor(private readonly globalPrisma: GlobalPrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const storeId = req?.user?.store_id as number | null | undefined;
    if (!storeId) return true;

    const store = await this.globalPrisma.stores.findUnique({
      where: { id: storeId },
      select: { industries: true },
    });
    if (!store) return true;
    if (storeSupportsServiceStations(store.industries)) return true;

    this.logger.warn(
      `Blocked service stations: store_id=${storeId} industries=[${(store.industries ?? []).join(',') || 'none'}]`,
    );
    throw new VendixHttpException(ErrorCodes.STATION_INDUSTRY_001, undefined, {
      store_id: storeId,
      industries: store.industries ?? [],
    });
  }
}
