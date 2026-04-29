import { Injectable, ConflictException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';

type EntryStatus = 'draft' | 'posted' | 'voided';

const VALID_TRANSITIONS: Record<EntryStatus, EntryStatus[]> = {
  draft: ['posted'],
  posted: ['voided'],
  voided: [],
};

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

@Injectable()
export class JournalEntryFlowService {
  private readonly logger = new Logger(JournalEntryFlowService.name);

  constructor(private readonly prisma: StorePrismaService) {}

  private getContext() {
    const context = RequestContextService.getContext();
    if (!context) {
      throw new Error('No request context found');
    }
    return context;
  }

  private async getEntry(id: number) {
    const entry = await this.prisma.accounting_entries.findFirst({
      where: { id },
      include: ENTRY_INCLUDE,
    });

    if (!entry) {
      throw new VendixHttpException(ErrorCodes.ACC_FIND_002);
    }

    return entry;
  }

  private validateTransition(
    current_status: string,
    target_status: EntryStatus,
  ): void {
    const valid_targets =
      VALID_TRANSITIONS[current_status as EntryStatus] || [];
    if (!valid_targets.includes(target_status)) {
      throw new ConflictException(
        `Invalid status transition: cannot change from '${current_status}' to '${target_status}'. ` +
          `Valid transitions from '${current_status}': [${valid_targets.join(', ') || 'none (terminal state)'}]`,
      );
    }
  }

  async post(id: number) {
    const entry = await this.getEntry(id);
    const context = this.getContext();

    this.validateTransition(entry.status, 'posted');

    // Validate double-entry balance
    const total_debit = Number(entry.total_debit);
    const total_credit = Number(entry.total_credit);

    if (Math.abs(total_debit - total_credit) > 0.001) {
      throw new VendixHttpException(
        ErrorCodes.ACC_VALIDATE_001,
        `Cannot post: total debit (${total_debit}) does not equal total credit (${total_credit})`,
      );
    }

    // Validate fiscal period is open
    if (entry.fiscal_period.status !== 'open') {
      throw new ConflictException(
        `Cannot post entry: fiscal period '${entry.fiscal_period.name}' is '${entry.fiscal_period.status}'`,
      );
    }

    const updated = await this.prisma.accounting_entries.update({
      where: { id },
      data: {
        status: 'posted',
        posted_by_user_id: context.user_id,
        posted_at: new Date(),
      },
      include: ENTRY_INCLUDE,
    });

    this.logger.log(
      `Journal entry #${id} (${entry.entry_number}) posted by user #${context.user_id}`,
    );
    return updated;
  }

  async void(id: number) {
    const entry = await this.getEntry(id);
    const context = this.getContext();

    this.validateTransition(entry.status, 'voided');

    // Create reversal entry and void the original in a transaction
    const result = await this.prisma.$transaction(async (tx: any) => {
      // Void the original entry
      const voided_entry = await tx.accounting_entries.update({
        where: { id },
        data: {
          status: 'voided',
        },
      });

      // Generate reversal entry number
      const year = new Date().getFullYear();
      const prefix = `AE-${year}-`;
      const latest = await tx.accounting_entries.findFirst({
        where: {
          organization_id: context.organization_id,
          entry_number: { startsWith: prefix },
        },
        orderBy: { entry_number: 'desc' },
      });

      let sequence = 1;
      if (latest) {
        const last_number = parseInt(
          latest.entry_number.replace(prefix, ''),
          10,
        );
        if (!isNaN(last_number)) {
          sequence = last_number + 1;
        }
      }
      const reversal_number = `${prefix}${String(sequence).padStart(6, '0')}`;

      // Create reversal entry (swap debits and credits)
      const reversal_entry = await tx.accounting_entries.create({
        data: {
          organization_id: context.organization_id,
          store_id: entry.store_id,
          entry_number: reversal_number,
          entry_type: entry.entry_type,
          status: 'posted',
          fiscal_period_id: entry.fiscal_period_id,
          entry_date: new Date(),
          description:
            `Reversal of ${entry.entry_number}: ${entry.description || ''}`.trim(),
          source_type: 'reversal',
          source_id: entry.id,
          total_debit: entry.total_debit,
          total_credit: entry.total_credit,
          created_by_user_id: context.user_id,
          posted_by_user_id: context.user_id,
          posted_at: new Date(),
        },
      });

      // Create reversed lines (swap debit/credit)
      const original_lines = entry.accounting_entry_lines;
      if (original_lines && original_lines.length > 0) {
        await tx.accounting_entry_lines.createMany({
          data: original_lines.map((line: any) => ({
            entry_id: reversal_entry.id,
            account_id: line.account_id,
            description: `Reversal: ${line.description || ''}`.trim(),
            debit_amount: line.credit_amount, // Swap
            credit_amount: line.debit_amount, // Swap
          })),
        });
      }

      return { voided_entry, reversal_entry };
    });

    this.logger.log(
      `Journal entry #${id} (${entry.entry_number}) voided by user #${context.user_id}. ` +
        `Reversal entry created: ${result.reversal_entry.entry_number}`,
    );

    // Return the voided entry with full includes
    return this.getEntry(id);
  }

  getValidTransitions(current_status: string): EntryStatus[] {
    return VALID_TRANSITIONS[current_status as EntryStatus] || [];
  }
}
