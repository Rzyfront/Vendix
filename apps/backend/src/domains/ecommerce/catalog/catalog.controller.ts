import { Controller, Get, Param, ParseIntPipe, Query, Header } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CatalogService } from './catalog.service';
import { ServicePlanPublicService } from './service-plan-public.service';
import { CatalogQueryDto } from './dto/catalog-query.dto';
import { Public } from '@common/decorators/public.decorator';

@Controller('ecommerce/catalog')
export class CatalogController {
  constructor(
    private readonly catalog_service: CatalogService,
    private readonly servicePlanPublic: ServicePlanPublicService,
  ) {}

  // D.3 (F-047, ERR-22): 100 req/min por IP (mismo techo que /public/plans).
  // El guard global llavea por IP real; excedido ⇒ 429 + RATE_LIMIT_001.
  @Public()
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  @Get()
  @Header('Cache-Control', 'no-store')
  async getProducts(@Query() query: CatalogQueryDto) {
    // store_id se resuelve automáticamente desde el dominio por DomainResolverMiddleware
    const result = await this.catalog_service.getProducts(query);
    return { success: true, ...result };
  }

  @Public()
  @Get('categories')
  @Header('Cache-Control', 'no-store')
  async getCategories() {
    // store_id se resuelve automáticamente desde el dominio por DomainResolverMiddleware
    const data = await this.catalog_service.getCategories();
    return { success: true, data };
  }

  @Public()
  @Get('brands')
  @Header('Cache-Control', 'no-store')
  async getBrands() {
    // store_id se resuelve automáticamente desde el dominio por DomainResolverMiddleware
    const data = await this.catalog_service.getBrands();
    return { success: true, data };
  }

  @Public()
  @Get('config/public')
  @Header('Cache-Control', 'no-store')
  async getPublicConfig() {
    const data = await this.catalog_service.getPublicConfig();
    return { success: true, data };
  }

  @Public()
  @Get('menus')
  @Header('Cache-Control', 'no-store')
  async getMenus() {
    // store_id se resuelve automáticamente desde el dominio por DomainResolverMiddleware.
    // Devuelve cartas activas con disponibilidad por horario; vacío si la
    // tienda no es de industria restaurant. Independiente del catálogo.
    const data = await this.catalog_service.getPublicMenus();
    return { success: true, data };
  }

  /**
   * QUI-1060 F2: ficha pública de un plan de varios días (duración, eventos
   * abiertos con cupos, precio por grupo e itinerario público). Nunca expone
   * costos, responsables ni contactos de terceros.
   */
  @Public()
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  @Get('plans/:productId')
  @Header('Cache-Control', 'no-store')
  async getServicePlan(@Param('productId', ParseIntPipe) productId: number) {
    const data = await this.servicePlanPublic.getPublicPlan(productId);
    return { success: true, data };
  }

  @Public()
  @Get(':slug')
  @Header('Cache-Control', 'no-store')
  async getProductBySlug(@Param('slug') slug: string) {
    // store_id se resuelve automáticamente desde el dominio por DomainResolverMiddleware
    const data = await this.catalog_service.getProductBySlug(slug);
    return { success: true, data };
  }
}
