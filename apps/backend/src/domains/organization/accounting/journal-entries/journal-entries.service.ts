import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { OrganizationPrismaService } from '../../../../prisma/services/organization-prisma.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';

import { JournalEntriesService as StoreJournalEntriesService } from '../../../store/accounting/journal-entries/journal-entries.service';
import { JournalEntryFlowService } from '../../../store/accounting/journal-entries/journal-entry-flow.service';
import { CreateJournalEntryDto } from '../../../store/accounting/journal-entries/dto/create-journal-entry.dto';
import { UpdateJournalEntryDto } from '../../../store/accounting/journal-entries/dto/update-journal-entry.dto';
import { QueryJournalEntryDto } from '../../../store/accounting/journal-entries/dto/query-journal-entry.dto';

import { OrgAccountingScopeService } from '../org-accounting-scope.service';

const ENTRY_INCLUDE = {
  accounting_entry_lines: {
    include: {
      account: {
        select: {
          id: true,
          code: true,
          name: true,
          account_type: true,
          nature: true,
        },
      },
    },
    orderBy: { id: 'asc' as const },
  },
  fiscal_period: {
    select: {
      id: true,
      name: true,
      start_date: true,
      end_date: true,
      status: true,
    },
  },
  created_by_user: {
    select: { id: true, first_name: true, last_name: true },
  },
  posted_by_user: {
    select: { id: true, first_name: true, last_name: true },
  },
  store: {
    select: { id: true, name: true },
  },
};

/**
 * Org-native journal entries.
 *
 * Reads:
 *   - operating_scope=ORGANIZATION → consolidated across the org via
 *     `OrganizationPrismaService` (auto-scoped by `organization_id`). The
 *     optional `store_id` query parameter narrows to a single store.
 *   - operating_scope=STORE → store_id is required (auto-resolved when the
 *     org has a single active store). Delegates to the store service for
 *     parity with the per-store domain.
 *
 * Writes (create / update / delete / post / void):
 *   - Always pinned to a target store via `runWithStoreContext`. In ORG mode
 *     a pivot store is selected (any active store of the org); the
 *     accounting_entity is still resolved by `operating_scope` so the entry
 *     lands on the org-level entity.
 */
@Injectable()
export class OrgJournalEntriesService {
  constructor(
    private readonly orgPrisma: OrganizationPrismaService,
    private readonly orgScope: OrgAccountingScopeService,
    private readonly storeJournalEntries: StoreJournalEntriesService,
    private readonly journalFlow: JournalEntryFlowService,
  ) {}

  async findAll(query: QueryJournalEntryDto) {
    const orgId = this.orgScope.requireOrgId();

    const {
      page = 1,
      limit = 10,
      search,
      sort_by = 'created_at',
      sort_order = 'desc',
      fiscal_period_id,
      entry_type,
      status,
      date_from,
      date_to,
      store_id,
    } = query;

    const skip = (page - 1) * limit;

    if (store_id != null) {
      // Per-store breakdown: validate store ownership.
      await this.orgScope.assertStoreInOrg(store_id);
    }

    const where: Prisma.accounting_entriesWhereInput = {
      ...(search && {
        OR: [
          { entry_number: { contains: search, mode: 'insensitive' as const } },
          { description: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
      ...(fiscal_period_id && { fiscal_period_id }),
      ...(entry_type && { entry_type: entry_type as any }),
      ...(status && { status: status as any }),
      ...(store_id && { store_id }),
      ...(date_from && {
        entry_date: {
          gte: new Date(date_from),
          ...(date_to && { lte: new Date(date_to) }),
        },
      }),
    };

    // OrganizationPrismaService auto-scopes by organization_id.
    const [data, total] = await Promise.all([
      this.orgPrisma.accounting_entries.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sort_by]: sort_order },
        include: ENTRY_INCLUDE,
      }),
      this.orgPrisma.accounting_entries.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: number) {
    // Auto-scoped by organization_id.
    const entry = await this.orgPrisma.accounting_entries.findFirst({
      where: { id },
      include: ENTRY_INCLUDE,
    });
    if (!entry) {
      throw new VendixHttpException(ErrorCodes.ACC_FIND_002);
    }
    return entry;
  }

  async create(dto: CreateJournalEntryDto, store_id_filter?: number) {
    const targetStoreId =
      store_id_filter ?? dto.store_id ?? (await this.pickPivotStoreId());
    return this.orgScope.runWithStoreContext(targetStoreId, () =>
      this.storeJournalEntries.create(dto),
    );
  }

  async update(
    id: number,
    dto: UpdateJournalEntryDto,
    store_id_filter?: number,
  ) {
    // Resolve store from the entry itself when not provided.
    const targetStoreId =
      store_id_filter ?? (await this.resolveStoreIdForEntry(id));
    return this.orgScope.runWithStoreContext(targetStoreId, () =>
      this.storeJournalEntries.update(id, dto),
    );
  }

  async remove(id: number, store_id_filter?: number) {
    const targetStoreId =
      store_id_filter ?? (await this.resolveStoreIdForEntry(id));
    return this.orgScope.runWithStoreContext(targetStoreId, () =>
      this.storeJournalEntries.remove(id),
    );
  }

  async post(id: number, store_id_filter?: number) {
    const targetStoreId =
      store_id_filter ?? (await this.resolveStoreIdForEntry(id));
    return this.orgScope.runWithStoreContext(targetStoreId, () =>
      this.journalFlow.post(id),
    );
  }

  async voidEntry(id: number, store_id_filter?: number) {
    const targetStoreId =
      store_id_filter ?? (await this.resolveStoreIdForEntry(id));
    return this.orgScope.runWithStoreContext(targetStoreId, () =>
      this.journalFlow.void(id),
    );
  }

  /**
   * Resolve the store_id of an entry to use as pivot for delegated mutations.
   * Falls back to any active store of the org when the entry is org-scoped
   * (`store_id IS NULL`, typical when operating_scope=ORGANIZATION).
   */
  private async resolveStoreIdForEntry(id: number): Promise<number> {
    const entry = await this.orgPrisma.accounting_entries.findFirst({
      where: { id },
      select: { id: true, store_id: true },
    });
    if (!entry) {
      throw new VendixHttpException(ErrorCodes.ACC_FIND_002);
    }
    if (entry.store_id) return entry.store_id;
    return this.pickPivotStoreId();
  }

  private async pickPivotStoreId(): Promise<number> {
    const storeIds = await this.orgScope.getStoreIdsForOrg();
    if (storeIds.length === 0) {
      throw new VendixHttpException(
        ErrorCodes.STORE_CONTEXT_001,
        'Organization has no active stores',
      );
    }
    return storeIds[0];
  }
}
