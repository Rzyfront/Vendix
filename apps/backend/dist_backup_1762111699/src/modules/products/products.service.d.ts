import { PrismaService } from '../../prisma/prisma.service';
import { CreateProductDto, UpdateProductDto, ProductQueryDto, CreateProductVariantDto, UpdateProductVariantDto, ProductImageDto } from './dto';
export declare class ProductsService {
    private prisma;
    constructor(prisma: PrismaService);
    create(createProductDto: CreateProductDto): Promise<any>;
    findAll(query: ProductQueryDto): Promise<{
        data: any;
        meta: {
            total: any;
            page: number;
            limit: number;
            totalPages: number;
        };
    }>;
    findOne(id: number): Promise<any>;
    findBySlug(storeId: number, slug: string): Promise<any>;
    update(id: number, updateProductDto: UpdateProductDto): Promise<any>;
    deactivate(id: number): Promise<any>;
    remove(id: number): Promise<any>;
    getProductsByStore(storeId: number): Promise<any>;
    createVariant(createVariantDto: CreateProductVariantDto): Promise<any>;
    updateVariant(variantId: number, updateVariantDto: UpdateProductVariantDto): Promise<any>;
    removeVariant(variantId: number): Promise<any>;
    addImage(productId: number, imageDto: ProductImageDto): Promise<any>;
    removeImage(imageId: number): Promise<any>;
}
