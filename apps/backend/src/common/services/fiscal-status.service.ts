import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import {
  ErrorCodes,
  VendixHttpException,
} from '../errors';
import {
  FiscalArea,
  FiscalDetectorSignals,
  FiscalStatusBlock,
  FiscalStatusReadResult,
  FiscalStatusSource,
  FiscalWizardStepId,
  isFiscalArea,
  isFiscalWizardStep,
  normalizeFiscalStatusBlock,
} from '../interfaces/fiscal-status.interface';
import { FiscalStatusResolverService } from './fiscal-status-resolver.service';
import { buildFiscalWizardSequence } from './fiscal-status.wizard-config';

const FISCAL_AREAS: FiscalArea[] = ['invoicing', 'accounting', 'payroll'];

@Injectable()
export class FiscalStatusService {
  constructor(
    private readonly globalPrisma: GlobalPrismaService,
    private readonly resolver: FiscalStatusResolverService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async read(
    organization_id: number,
    store_id?: number | null,
  ): Promise<FiscalStatusReadResult> {
    const client = this.globalPrisma.withoutScope();
    const organization = await client.organizations.findUnique({
      where: { id: organization_id },
      select: { fiscal_scope: true },
    });

    if ((organization?.fiscal_scope ?? 'STORE') === 'STORE' && !store_id) {
      const stores = await client.stores.findMany({
        where: { organization_id, is_active: true },
        select: { id: true, name: true },
        orderBy: { id: 'asc' },
      });
      const store_statuses: FiscalStatusReadResult['store_statuses'] = [];
      for (const store of stores) {
        const status = await this.resolver.getStatusBlock(
          organization_id,
          store.id,
        );
        store_statuses.push({
          store_id: store.id,
          store_name: store.name,
          fiscal_status: status.fiscal_status,
        });
      }
      return {
        organization_id,
        store_id: null,
        fiscal_scope: 'STORE',
        fiscal_status: normalizeFiscalStatusBlock(null),
        store_statuses,
      };
    }

    const resolved = await this.resolver.getStatusBlock(
      organization_id,
      store_id,
    );

    return {
      organization_id,
      store_id: resolved.store_id,
      fiscal_scope: resolved.fiscal_scope,
      fiscal_status: resolved.fiscal_status,
    };
  }

  async startWizard(params: {
    organization_id: number;
    store_id?: number | null;
    selected_areas: FiscalArea[];
    changed_by_user_id?: number | null;
  }) {
    const selectedAreas = this.normalizeAreas(params.selected_areas);
    if (selectedAreas.length === 0) {
      throw new VendixHttpException(
        ErrorCodes.FISCAL_STATUS_WIZARD_STEP_INVALID,
        'At least one fiscal area is required',
      );
    }
    const sequence = buildFiscalWizardSequence(selectedAreas);
    const now = new Date().toISOString();

    return this.mutate(
      params.organization_id,
      params.store_id,
      'manual',
      params.changed_by_user_id,
      async (block) => {
        for (const area of selectedAreas) {
          if (block[area].state === 'LOCKED') {
            throw new VendixHttpException(
              ErrorCodes.FISCAL_STATUS_LOCKED,
              `Fiscal area ${area} is locked`,
            );
          }
          block[area] = {
            ...block[area],
            state: 'WIP',
            wizard: {
              selected_areas: selectedAreas,
              step_sequence: sequence,
              current_step: sequence[1] ?? sequence[0] ?? null,
              completed_steps: ['area_selection'],
              step_data: {},
              started_at: block[area].wizard.started_at ?? now,
              updated_at: now,
            },
            updated_at: now,
          };
        }
        return block;
      },
    );
  }

  async advanceStep(params: {
    organization_id: number;
    store_id?: number | null;
    step: FiscalWizardStepId;
    data?: Record<string, unknown>;
    changed_by_user_id?: number | null;
  }) {
    if (!isFiscalWizardStep(params.step)) {
      throw new VendixHttpException(
        ErrorCodes.FISCAL_STATUS_WIZARD_STEP_INVALID,
        `Invalid fiscal wizard step: ${String(params.step)}`,
      );
    }
    const now = new Date().toISOString();

    return this.mutate(
      params.organization_id,
      params.store_id,
      'manual',
      params.changed_by_user_id,
      async (block) => {
        const areas = this.getWizardAreas(block);
        if (areas.length === 0) {
          throw new VendixHttpException(
            ErrorCodes.FISCAL_STATUS_INVALID_TRANSITION,
            'No fiscal wizard is in progress',
          );
        }

        for (const area of areas) {
          const wizard = block[area].wizard;
          if (!wizard.step_sequence.includes(params.step)) {
            throw new VendixHttpException(
              ErrorCodes.FISCAL_STATUS_WIZARD_STEP_INVALID,
              `Step ${params.step} is not part of this wizard`,
            );
          }
          const completed = new Set(wizard.completed_steps);
          completed.add(params.step);
          const completed_steps = wizard.step_sequence.filter((step) =>
            completed.has(step),
          );
          const current_step =
            wizard.step_sequence.find((step) => !completed.has(step)) ?? null;

          block[area] = {
            ...block[area],
            wizard: {
              ...wizard,
              completed_steps,
              current_step,
              step_data: {
                ...wizard.step_data,
                [params.step]: params.data ?? {},
              },
              updated_at: now,
            },
            updated_at: now,
          };
        }
        return block;
      },
    );
  }

  async finalizeActivation(params: {
    organization_id: number;
    store_id?: number | null;
    selected_areas?: FiscalArea[];
    changed_by_user_id?: number | null;
  }) {
    const now = new Date().toISOString();
    return this.mutate(
      params.organization_id,
      params.store_id,
      'manual',
      params.changed_by_user_id,
      async (block) => {
        const areas = params.selected_areas?.length
          ? this.normalizeAreas(params.selected_areas)
          : this.getWizardAreas(block);
        if (areas.length === 0) {
          throw new VendixHttpException(
            ErrorCodes.FISCAL_STATUS_INVALID_TRANSITION,
            'No fiscal areas selected for activation',
          );
        }

        for (const area of areas) {
          if (block[area].state === 'LOCKED') continue;
          if (block[area].state !== 'WIP' && block[area].state !== 'INACTIVE') {
            throw new VendixHttpException(
              ErrorCodes.FISCAL_STATUS_INVALID_TRANSITION,
              `Fiscal area ${area} cannot be finalized from ${block[area].state}`,
            );
          }
          block[area] = {
            ...block[area],
            state: 'ACTIVE',
            activated_at: block[area].activated_at ?? now,
            updated_at: now,
            wizard: {
              ...block[area].wizard,
              current_step: null,
              completed_steps: block[area].wizard.step_sequence,
              updated_at: now,
            },
          };
        }
        return block;
      },
    );
  }

  async attemptDeactivation(params: {
    organization_id: number;
    store_id?: number | null;
    area: FiscalArea;
    changed_by_user_id?: number | null;
  }) {
    if (!isFiscalArea(params.area)) {
      throw new VendixHttpException(
        ErrorCodes.FISCAL_STATUS_INVALID_TRANSITION,
        'Invalid fiscal area',
      );
    }

    const irreversibility = await this.checkIrreversibility(params);
    if (irreversibility.locked) {
      await this.lock({
        ...params,
        reasons: irreversibility.reasons,
        source: 'event',
      });
      throw new VendixHttpException(
        ErrorCodes.FISCAL_STATUS_DEACTIVATION_BLOCKED,
        'Fiscal status cannot be deactivated because fiscal records already exist',
        irreversibility,
      );
    }

    const now = new Date().toISOString();
    return this.mutate(
      params.organization_id,
      params.store_id,
      'manual',
      params.changed_by_user_id,
      async (block) => {
        if (block[params.area].state === 'LOCKED') {
          throw new VendixHttpException(
            ErrorCodes.FISCAL_STATUS_LOCKED,
            'Fiscal status is locked',
          );
        }
        block[params.area] = {
          ...block[params.area],
          state: 'INACTIVE',
          updated_at: now,
          wizard: {
            ...block[params.area].wizard,
            current_step: null,
            updated_at: now,
          },
        };
        return block;
      },
    );
  }

  async checkIrreversibility(params: {
    organization_id: number;
    store_id?: number | null;
    area?: FiscalArea;
  }): Promise<{ locked: boolean; reasons: string[] }> {
    const areas = params.area ? [params.area] : FISCAL_AREAS;
    const client = this.globalPrisma.withoutScope();
    const whereTenant: Record<string, unknown> = {
      organization_id: params.organization_id,
    };
    if (params.store_id) {
      whereTenant.store_id = params.store_id;
    }
    const reasons: string[] = [];

    if (areas.includes('invoicing')) {
      const acceptedInvoices = await client.invoices.count({
        where: {
          ...whereTenant,
          OR: [
            { status: 'accepted' },
            { accepted_at: { not: null } },
            { cufe: { not: null } },
          ],
        } as any,
      });
      if (acceptedInvoices > 0) {
        reasons.push('accepted_invoice_with_cufe');
      }
    }

    if (areas.includes('accounting')) {
      const postedEntries = await client.accounting_entries.count({
        where: { ...whereTenant, status: 'posted' } as any,
      });
      if (postedEntries > 0) {
        reasons.push('posted_accounting_entry');
      }
    }

    if (areas.includes('payroll')) {
      const settledPayroll = await client.payroll_runs.count({
        where: {
          ...whereTenant,
          status: { in: ['accepted', 'paid'] },
        } as any,
      });
      if (settledPayroll > 0) {
        reasons.push('settled_payroll_run');
      }
    }

    return { locked: reasons.length > 0, reasons };
  }

  async lock(params: {
    organization_id: number;
    store_id?: number | null;
    area: FiscalArea;
    reasons: string[];
    source?: FiscalStatusSource;
    changed_by_user_id?: number | null;
  }) {
    const now = new Date().toISOString();
    return this.mutate(
      params.organization_id,
      params.store_id,
      params.source ?? 'event',
      params.changed_by_user_id,
      async (block) => {
        block[params.area] = {
          ...block[params.area],
          state: 'LOCKED',
          locked_reasons: Array.from(
            new Set([...block[params.area].locked_reasons, ...params.reasons]),
          ),
          locked_at: block[params.area].locked_at ?? now,
          updated_at: now,
        };
        return block;
      },
    );
  }

  async applyDetectorSignals(params: {
    organization_id: number;
    store_id?: number | null;
    signals: FiscalDetectorSignals;
  }) {
    const now = new Date().toISOString();
    return this.mutate(
      params.organization_id,
      params.store_id,
      'detector',
      null,
      async (block) => {
        const score = this.scoreSignals(params.signals);
        const signals = {
          ...params.signals,
          score,
          evaluated_at: now,
        };

        for (const area of FISCAL_AREAS) {
          block[area] = {
            ...block[area],
            detector_signals: signals,
            updated_at: now,
          };
        }
        return block;
      },
    );
  }

  private async mutate(
    organization_id: number,
    store_id: number | null | undefined,
    source: FiscalStatusSource,
    changed_by_user_id: number | null | undefined,
    mutator: (block: FiscalStatusBlock) => Promise<FiscalStatusBlock>,
  ) {
    let before: FiscalStatusBlock | null = null;
    let after: FiscalStatusBlock | null = null;
    const result = await this.resolver.writeStatusBlock(
      organization_id,
      store_id,
      async (block) => {
        before = this.cloneBlock(block);
        after = normalizeFiscalStatusBlock(await mutator(block));
        return after;
      },
    );

    if (before && after) {
      await this.writeAuditRows({
        organization_id,
        store_id: result.store_id,
        source,
        changed_by_user_id: changed_by_user_id ?? null,
        before,
        after,
      });
      this.eventEmitter.emit('fiscal_status.changed', {
        organization_id,
        store_id: result.store_id,
        source,
        before,
        after,
      });
    }

    return result;
  }

  private async writeAuditRows(params: {
    organization_id: number;
    store_id: number | null;
    source: FiscalStatusSource;
    changed_by_user_id: number | null;
    before: FiscalStatusBlock;
    after: FiscalStatusBlock;
  }): Promise<void> {
    const client = this.globalPrisma.withoutScope() as any;
    for (const area of FISCAL_AREAS) {
      if (
        JSON.stringify(params.before[area]) ===
        JSON.stringify(params.after[area])
      ) {
        continue;
      }
      await client.fiscal_status_audit_log.create({
        data: {
          organization_id: params.organization_id,
          store_id: params.store_id,
          feature: area,
          from_state: params.before[area].state,
          to_state: params.after[area].state,
          source: params.source,
          before_json: params.before[area] as any,
          after_json: params.after[area] as any,
          changed_by_user_id: params.changed_by_user_id,
        },
      });
    }
  }

  private getWizardAreas(block: FiscalStatusBlock): FiscalArea[] {
    const areas = new Set<FiscalArea>();
    for (const area of FISCAL_AREAS) {
      if (block[area].state === 'WIP') {
        const selected = block[area].wizard.selected_areas.filter(isFiscalArea);
        if (selected.length > 0) {
          selected.forEach((selectedArea) => areas.add(selectedArea));
        } else {
          areas.add(area);
        }
      }
    }
    return Array.from(areas);
  }

  private normalizeAreas(areas: FiscalArea[]): FiscalArea[] {
    return Array.from(new Set(areas.filter(isFiscalArea)));
  }

  private scoreSignals(signals: FiscalDetectorSignals): number {
    return [
      signals.revenue_over_uvt,
      signals.transaction_volume,
      signals.b2b_invoices,
      signals.legal_person,
      signals.active_employees,
    ].filter(Boolean).length;
  }

  private cloneBlock(block: FiscalStatusBlock): FiscalStatusBlock {
    return JSON.parse(JSON.stringify(block));
  }
}
