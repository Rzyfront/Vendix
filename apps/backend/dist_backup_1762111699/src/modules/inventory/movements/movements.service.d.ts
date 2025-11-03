import { PrismaService } from '../../../prisma/prisma.service';
import { CreateMovementDto } from './dto/create-movement.dto';
import { MovementQueryDto } from './dto/movement-query.dto';
export declare class MovementsService {
    private prisma;
    constructor(prisma: PrismaService);
    create(createMovementDto: CreateMovementDto): Promise<any>;
    findAll(query: MovementQueryDto): any;
    findByProduct(productId: number, query: MovementQueryDto): any;
    findByLocation(locationId: number, query: MovementQueryDto): any;
    findByUser(userId: number, query: MovementQueryDto): any;
    findOne(id: number): any;
    private updateStockLevels;
    private updateStockLevel;
}
