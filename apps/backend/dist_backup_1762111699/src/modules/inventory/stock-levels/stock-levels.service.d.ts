import { PrismaService } from '../../../prisma/prisma.service';
import { StockLevelQueryDto } from './dto/stock-level-query.dto';
export declare class StockLevelsService {
    private prisma;
    constructor(prisma: PrismaService);
    findAll(query: StockLevelQueryDto): any;
    findByProduct(productId: number, query: StockLevelQueryDto): any;
    findByLocation(locationId: number, query: StockLevelQueryDto): any;
    getStockAlerts(query: StockLevelQueryDto): any;
    findOne(id: number): any;
    updateStockLevel(productId: number, locationId: number, quantityChange: number, productVariantId?: number): Promise<any>;
}
