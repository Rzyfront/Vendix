import { user_state_enum } from '@prisma/client';
export declare class UserQueryDto {
    page?: number;
    limit?: number;
    search?: string;
    state?: user_state_enum;
    organization_id?: number;
}
