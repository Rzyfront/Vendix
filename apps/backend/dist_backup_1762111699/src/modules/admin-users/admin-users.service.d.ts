import { PrismaService } from '../../prisma/prisma.service';
import { CreateUserDto, UpdateUserDto, UserQueryDto } from '../users/dto';
export declare class AdminUsersService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    create(createUserDto: CreateUserDto): Promise<any>;
    findAll(query: UserQueryDto): Promise<{
        data: any;
        meta: {
            total: any;
            page: number;
            limit: number;
            totalPages: number;
        };
    }>;
    findOne(id: number): Promise<any>;
    update(id: number, updateUserDto: UpdateUserDto): Promise<any>;
    remove(id: number): Promise<{
        message: string;
    }>;
    activateUser(id: number): Promise<{
        message: string;
    }>;
    deactivateUser(id: number): Promise<{
        message: string;
    }>;
    assignRole(userId: number, roleId: number): Promise<{
        message: string;
    }>;
    removeRole(userId: number, roleId: number): Promise<{
        message: string;
    }>;
    getDashboardStats(): Promise<{
        totalUsers: any;
        activeUsers: any;
        inactiveUsers: any;
        pendingUsers: any;
        usersByRole: any;
        recentUsers: any;
    }>;
}
