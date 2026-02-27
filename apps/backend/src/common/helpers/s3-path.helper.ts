import { Injectable } from '@nestjs/common';

/**
 * Interface for organization data needed to build S3 paths
 */
export interface S3OrgContext {
    id: number;
    slug: string;
}

/**
 * Interface for store data needed to build S3 paths
 */
export interface S3StoreContext {
    id: number;
    slug: string;
}

/**
 * S3 Path Helper
 *
 * Centralizes the construction of S3 paths for assets.
 * Uses slug-id format to ensure uniqueness across environments.
 *
 * @example
 * // Path: organizations/my-org-1/stores/my-store-2/products
 * const path = s3PathHelper.buildProductPath(org, store);
 */
@Injectable()
export class S3PathHelper {
    /**
     * Builds the base path for an organization
     * @returns organizations/{slug}-{id}
     */
    buildOrgPath(org: S3OrgContext): string {
        return `organizations/${org.slug}-${org.id}`;
    }

    /**
     * Builds the base path for a store within an organization
     * @returns organizations/{org_slug}-{org_id}/stores/{store_slug}-{store_id}
     */
    buildStorePath(org: S3OrgContext, store: S3StoreContext): string {
        return `${this.buildOrgPath(org)}/stores/${store.slug}-${store.id}`;
    }

    /**
     * Builds the path for product assets
     * @returns organizations/{org_slug}-{org_id}/stores/{store_slug}-{store_id}/products
     */
    buildProductPath(org: S3OrgContext, store: S3StoreContext): string {
        return `${this.buildStorePath(org, store)}/products`;
    }

    /**
     * Builds the path for category assets
     * @returns organizations/{org_slug}-{org_id}/stores/{store_slug}-{store_id}/categories
     */
    buildCategoryPath(org: S3OrgContext, store: S3StoreContext): string {
        return `${this.buildStorePath(org, store)}/categories`;
    }

    /**
     * Builds the path for store logos
     * @returns organizations/{org_slug}-{org_id}/stores/{store_slug}-{store_id}/logos
     */
    buildStoreLogoPath(org: S3OrgContext, store: S3StoreContext): string {
        return `${this.buildStorePath(org, store)}/logos`;
    }

    /**
     * Builds the path for ecommerce slider images
     * @returns organizations/{org_slug}-{org_id}/stores/{store_slug}-{store_id}/ecommerce/slider
     */
    buildEcommerceSliderPath(org: S3OrgContext, store: S3StoreContext): string {
        return `${this.buildStorePath(org, store)}/ecommerce/slider`;
    }

    /**
     * Builds the path for favicon assets
     * @returns organizations/{org_slug}-{org_id}/stores/{store_slug}-{store_id}/favicons
     */
    buildFaviconPath(org: S3OrgContext, store: S3StoreContext): string {
        return `${this.buildStorePath(org, store)}/favicons`;
    }

    /**
     * Builds the path for user avatars
     * @returns organizations/{org_slug}-{org_id}/users/{user_id}/avatars
     */
    buildAvatarPath(org: S3OrgContext, userId: number): string {
        return `${this.buildOrgPath(org)}/users/${userId}/avatars`;
    }

    /**
     * Builds the path for organization-level assets (brands, logos)
     * @returns organizations/{org_slug}-{org_id}/{entityType}
     */
    buildOrgEntityPath(org: S3OrgContext, entityType: string): string {
        return `${this.buildOrgPath(org)}/${entityType}`;
    }

    /**
     * Builds the path for support ticket attachments
     * @returns organizations/{org_slug}-{org_id}/support/{ticket_id}
     */
    buildSupportPath(org: S3OrgContext, ticketId: number): string {
        return `${this.buildOrgPath(org)}/support/${ticketId}`;
    }

    /**
     * Builds the path for expense receipt uploads
     * @returns organizations/{org_slug}-{org_id}/stores/{store_slug}-{store_id}/receipts
     */
    buildReceiptPath(org: S3OrgContext, store: S3StoreContext): string {
        return `${this.buildStorePath(org, store)}/receipts`;
    }
}
