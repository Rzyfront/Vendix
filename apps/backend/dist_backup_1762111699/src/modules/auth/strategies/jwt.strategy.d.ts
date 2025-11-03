import { Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';
export interface JwtPayload {
    sub: number;
    email: string;
    roles: string[];
    organization_id: number;
    store_id?: number | null;
}
declare const JwtStrategy_base: new (...args: [opt: import("passport-jwt").StrategyOptionsWithRequest] | [opt: import("passport-jwt").StrategyOptionsWithoutRequest]) => Strategy & {
    validate(...args: any[]): unknown;
};
export declare class JwtStrategy extends JwtStrategy_base {
    private configService;
    private prismaService;
    constructor(configService: ConfigService, prismaService: PrismaService);
    validate(payload: JwtPayload): Promise<{
        id: number;
        email: string;
        first_name: string;
        last_name: string;
        fullName: string;
        organization_id: number;
        store_id: number | null;
        user_roles: ({
            roles: ({
                role_permissions: ({
                    permissions: {
                        id: number;
                        name: string;
                        description: string | null;
                        path: string;
                        method: import(".prisma/client").$Enums.http_method_enum;
                        status: import(".prisma/client").$Enums.permission_status_enum;
                        created_at: Date | null;
                        updated_at: Date | null;
                    };
                } & {
                    id: number;
                    created_at: Date | null;
                    role_id: number;
                    permission_id: number;
                    granted: boolean;
                })[];
            } & {
                id: number;
                name: string;
                description: string | null;
                created_at: Date | null;
                updated_at: Date | null;
                is_system_role: boolean;
            }) | null;
        } & {
            id: number;
            role_id: number | null;
            user_id: number | null;
        })[];
        roles: string[];
        permissions: {
            path: string;
            method: import(".prisma/client").$Enums.http_method_enum;
            status: import(".prisma/client").$Enums.permission_status_enum;
        }[];
    }>;
}
export {};
