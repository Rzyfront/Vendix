import { PrismaService } from '../../../prisma/prisma.service';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { UpdateTransferDto } from './dto/update-transfer.dto';
import { TransferQueryDto } from './dto/transfer-query.dto';
import { transfer_status_enum } from '@prisma/client';
export declare class StockTransfersService {
    private prisma;
    constructor(prisma: PrismaService);
    create(createTransferDto: CreateTransferDto): Promise<any>;
    findAll(query: TransferQueryDto): any;
    findByStatus(status: transfer_status_enum, query: TransferQueryDto): any;
    findByFromLocation(locationId: number, query: TransferQueryDto): any;
    findByToLocation(locationId: number, query: TransferQueryDto): any;
    findOne(id: number): any;
    update(id: number, updateTransferDto: UpdateTransferDto): Promise<any>;
    approve(id: number): Promise<any>;
    startTransfer(id: number): Promise<any>;
    complete(id: number, items: Array<{
        id: number;
        quantity_received: number;
    }>): Promise<any>;
    cancel(id: number): Promise<any>;
    remove(id: number): any;
    private generateTransferNumber;
    private reserveStock;
    private releaseStock;
    private updateStockLevel;
}
