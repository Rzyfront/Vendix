import { Injectable } from '@nestjs/common';

import { AccountMappingService } from '../../../store/accounting/account-mappings/account-mapping.service';

import { OrgAccountingScopeService } from '../org-accounting-scope.service';

/**
 * Org-native account mappings.
 *
 * `account_mappings` are inherently `organization_id`-scoped (with optional
 * per-store overrides), so the underlying store-side `AccountMappingService`
 * already accepts `org_id` and an optional `store_id` and performs all
 * operations safely. We forward calls verbatim while validating that any
 * incoming `store_id` belongs to the org in context.
 */
@Injectable()
export class OrgAccountMappingsService {
  constructor(
    private readonly orgScope: OrgAccountingScopeService,
    private readonly storeMappings: AccountMappingService,
  ) {}

  async getMappings(prefix?: string, store_id?: number) {
    const orgId = this.orgScope.requireOrgId();
    if (store_id != null) {
      await this.orgScope.assertStoreInOrg(store_id);
    }
    return this.storeMappings.getMappings(orgId, prefix, store_id);
  }

  async bulkUpsertMappings(
    mappings: Array<{ mapping_key: string; account_id: number }>,
    store_id?: number,
  ) {
    const orgId = this.orgScope.requireOrgId();
    if (store_id != null) {
      await this.orgScope.assertStoreInOrg(store_id);
    }
    return this.storeMappings.bulkUpsertMappings(orgId, mappings, store_id);
  }

  async resetToDefaults(store_id?: number) {
    const orgId = this.orgScope.requireOrgId();
    if (store_id != null) {
      await this.orgScope.assertStoreInOrg(store_id);
    }
    return this.storeMappings.resetToDefaults(orgId, store_id);
  }
}
