import { user_state_enum } from '@prisma/client';
export declare class CreateUserDto {
    app?: string;
    organization_id: number;
    first_name: string;
    last_name: string;
    username: string;
    email: string;
    password: string;
    state?: user_state_enum;
}
