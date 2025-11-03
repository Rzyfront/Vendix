import { StockTransfersService } from './stock-transfers.service';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { UpdateTransferDto } from './dto/update-transfer.dto';
import { TransferQueryDto } from './dto/transfer-query.dto';
export declare class StockTransfersController {
    private readonly stockTransfersService;
    constructor(stockTransfersService: StockTransfersService);
    create(createTransferDto: CreateTransferDto): Promise<any>;
    findAll(query: TransferQueryDto): any;
    findDrafts(query: TransferQueryDto): any;
    findInTransit(query: TransferQueryDto): any;
    findByFromLocation(locationId: string, query: TransferQueryDto): any;
    findByToLocation(locationId: string, query: TransferQueryDto): any;
    findOne(id: string): any;
    update(id: string, updateTransferDto: UpdateTransferDto): Promise<any>;
    approve(id: string): Promise<any>;
    startTransfer(id: string): Promise<any>;
    complete(id: string, completeData: {
        items: Array<{
            id: number;
            quantity_received: number;
        }>;
    }): Promise<any>;
    cancel(id: string): Promise<any>;
    remove(id: string): any;
}
