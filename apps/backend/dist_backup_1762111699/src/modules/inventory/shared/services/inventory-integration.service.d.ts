import { PrismaService } from '../../../../prisma/prisma.service';
export declare class InventoryIntegrationService {
    private prisma;
    constructor(prisma: PrismaService);
    reserveStock(organizationId: number, productId: number, locationId: number, quantity: number, orderType: string, orderId: number, productVariantId?: number): Promise<any>;
    releaseStock(organizationId: number, productId: number, locationId: number, quantity: number, orderType: string, orderId: number, productVariantId?: number): Promise<any>;
    updateStockAndCreateMovement(organizationId: number, productId: number, locationId: number, quantityChange: number, movementType: string, sourceOrderType?: string, sourceOrderId?: number, reason?: string, productVariantId?: number, fromLocationId?: number, toLocationId?: number): Promise<any>;
    calculateWeightedAverageCost(organizationId: number, productId: number, locationId?: number, productVariantId?: number): Promise<number>;
    checkStockAvailability(organizationId: number, productId: number, requiredQuantity: number, productVariantId?: number): Promise<Array<{
        locationId: number;
        available: number;
        locationName: string;
    }>>;
    getLowStockAlerts(organizationId: number, locationId?: number): Promise<Array<{
        productId: number;
        productName: string;
        locationId: number;
        locationName: string;
        currentStock: number;
        reorderPoint: number;
    }>>;
    getInventoryValuation(organizationId: number, locationId?: number): Promise<{
        totalValue: number;
        itemCount: number;
        locationBreakdown: Array<{
            locationId: number;
            locationName: string;
            value: number;
        }>;
    }>;
    cleanupExpiredReservations(organizationId: number): Promise<number>;
}
