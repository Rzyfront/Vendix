import { PrismaService } from '../../prisma/prisma.service';
import { CreateUserDto, UpdateUserDto, UserQueryDto, UsersDashboardDto } from './dto';
import { EmailService } from '../../email/email.service';
export declare class UsersService {
    private prisma;
    private emailService;
    constructor(prisma: PrismaService, emailService: EmailService);
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
    findOne(id: number, includeSuspended?: boolean): Promise<any>;
    update(id: number, updateUserDto: UpdateUserDto): Promise<any>;
    remove(id: number): Promise<any>;
    archive(id: number): Promise<any>;
    reactivate(id: number): Promise<any>;
    getDashboard(query: UsersDashboardDto): Promise<{
        data: {
            total_usuarios: any;
            activos: any;
            pendientes: any;
            con_2fa: any;
            inactivos: any;
            suspendidos: any;
            email_verificado: any;
            archivados: any;
        };
    }>;
}
