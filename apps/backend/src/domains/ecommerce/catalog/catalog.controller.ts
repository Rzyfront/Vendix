import { Controller, Get, Param, Query } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { CatalogQueryDto } from './dto/catalog-query.dto';
import { Public } from '../../auth/decorators/public.decorator';

@Controller('ecommerce/catalog')
export class CatalogController {
    constructor(private readonly catalog_service: CatalogService) { }

    @Public()
    @Get()
    async getProducts(@Query() query: CatalogQueryDto) {
        // store_id se resuelve automáticamente desde el dominio por DomainResolverMiddleware
        const result = await this.catalog_service.getProducts(query);
        return { success: true, ...result };
    }

    @Public()
    @Get('categories')
    async getCategories() {
        // store_id se resuelve automáticamente desde el dominio por DomainResolverMiddleware
        const data = await this.catalog_service.getCategories();
        return { success: true, data };
    }

    @Public()
    @Get('brands')
    async getBrands() {
        // store_id se resuelve automáticamente desde el dominio por DomainResolverMiddleware
        const data = await this.catalog_service.getBrands();
        return { success: true, data };
    }

    @Public()
    @Get(':slug')
    async getProductBySlug(@Param('slug') slug: string) {
        // store_id se resuelve automáticamente desde el dominio por DomainResolverMiddleware
        const data = await this.catalog_service.getProductBySlug(slug);
        return { success: true, data };
    }
}
