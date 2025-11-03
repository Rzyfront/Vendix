import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreatePermissionDto, UpdatePermissionDto, PermissionFilterDto } from './dto/permission.dto';
import { http_method_enum } from '@prisma/client';
export declare class PermissionsService {
    private readonly prismaService;
    private readonly auditService;
    constructor(prismaService: PrismaService, auditService: AuditService);
    create(createPermissionDto: CreatePermissionDto, userId: number): Promise<any>;
    findAll(filterDto?: PermissionFilterDto, userId?: number): Promise<any>;
    findOne(id: number, userId?: number): Promise<any>;
    update(id: number, updatePermissionDto: UpdatePermissionDto, userId: number): Promise<any>;
    remove(id: number, userId: number): Promise<{
        message: string;
    }>;
    findByIds(ids: number[]): Promise<any>;
    findByName(name: string): Promise<any>;
    findByPathAndMethod(path: string, method: http_method_enum): Promise<any>;
}
