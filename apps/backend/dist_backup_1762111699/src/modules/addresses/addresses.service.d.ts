import { PrismaService } from '../../prisma/prisma.service';
import { CreateAddressDto, UpdateAddressDto, AddressQueryDto } from './dto';
export declare class AddressesService {
    private prisma;
    constructor(prisma: PrismaService);
    create(createAddressDto: CreateAddressDto, user: any): Promise<any>;
    findAll(query: AddressQueryDto, user: any): Promise<{
        data: any;
        meta: {
            total: any;
            page: number;
            limit: number;
            totalPages: number;
        };
    }>;
    findOne(id: number, user: any): Promise<any>;
    findByStore(storeId: number, user: any): Promise<any>;
    update(id: number, updateAddressDto: UpdateAddressDto, user: any): Promise<any>;
    remove(id: number, user: any): Promise<{
        message: string;
    }>;
    private validateStoreAccess;
    private validateOrganizationAccess;
    private validateUserAccess;
    private unsetOtherDefaults;
}
