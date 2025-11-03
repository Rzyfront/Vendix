import { AsyncLocalStorage } from 'async_hooks';
export interface RequestContext {
    user_id?: number;
    organization_id?: number;
    store_id?: number;
    roles?: string[];
    is_super_admin: boolean;
    is_owner: boolean;
    email?: string;
}
export declare class RequestContextService {
    static asyncLocalStorage: AsyncLocalStorage<RequestContext>;
    private static currentContext;
    static run<T>(context: RequestContext, callback: () => T): T;
    static getContext(): RequestContext | undefined;
    static getOrganizationId(): number | undefined;
    static getStoreId(): number | undefined;
    static getUserId(): number | undefined;
    static isSuperAdmin(): boolean;
    static isOwner(): boolean;
    static hasRole(roleName: string): boolean;
    static getRoles(): string[];
}
