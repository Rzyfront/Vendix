import { Controller, Get, Param, Query, Headers } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { CatalogQueryDto } from './dto/catalog-query.dto';
import { Public } from '../../auth/decorators/public.decorator';

@Controller('ecommerce/catalog')
export class CatalogController {
    constructor(private readonly catalog_service: CatalogService) { }

    @Public()
    @Get()
    async getProducts(
        @Headers('x-store-id') store_id_header: string,
        @Query() query: CatalogQueryDto,
    ) {
        const store_id = parseInt(store_id_header, 10);
        if (!store_id) {
            return { success: false, message: 'Store ID required' };
        }
        const result = await this.catalog_service.getProducts(store_id, query);
        return { success: true, ...result };
    }

    @Public()
    @Get('categories')
    async getCategories(@Headers('x-store-id') store_id_header: string) {
        const store_id = parseInt(store_id_header, 10);
        if (!store_id) {
            return { success: false, message: 'Store ID required' };
        }
        const data = await this.catalog_service.getCategories(store_id);
        return { success: true, data };
    }

    @Public()
    @Get('brands')
    async getBrands(@Headers('x-store-id') store_id_header: string) {
        const store_id = parseInt(store_id_header, 10);
        if (!store_id) {
            return { success: false, message: 'Store ID required' };
        }
        const data = await this.catalog_service.getBrands(store_id);
        return { success: true, data };
    }

    @Public()
    @Get(':slug')
    async getProductBySlug(
        @Headers('x-store-id') store_id_header: string,
        @Param('slug') slug: string,
    ) {
        const store_id = parseInt(store_id_header, 10);
        if (!store_id) {
            return { success: false, message: 'Store ID required' };
        }
        const data = await this.catalog_service.getProductBySlug(store_id, slug);
        return { success: true, data };
    }
}
