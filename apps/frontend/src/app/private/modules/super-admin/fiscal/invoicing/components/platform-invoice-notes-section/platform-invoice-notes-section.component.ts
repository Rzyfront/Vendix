import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';

import { CurrencyPipe as VendixCurrencyPipe } from '../../../../../../../shared/pipes/currency';
import type { PlatformInvoiceNotesInfo } from '../../../../subscriptions/interfaces/fiscal-billing.interface';
import {
  transmissionStatusBadgeClasses,
  transmissionStatusLabel,
} from '../../platform-invoicing.constants';
import { toNumber } from '../platform-invoice-note-modal/platform-invoice-note-payload.util';
import {
  DIAN_CREDIT_NOTE_CONCEPTS,
  DIAN_DEBIT_NOTE_CONCEPTS,
} from '../../../../../store/invoicing/components/invoice-note-create/dian-note-concepts';

/** "Notas asociadas" block: notes of an invoice plus the creditable balance. */
@Component({
  selector: 'app-platform-invoice-notes-section',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, RouterLink, VendixCurrencyPipe],
  template: `
    @if (info(); as data) {
      <section class="space-y-2">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h3 class="text-sm font-semibold text-text-primary uppercase tracking-wide">
            Notas asociadas ({{ data.notes.length }})
          </h3>
          <p class="text-xs text-text-secondary">
            Saldo acreditable:
            <span class="font-semibold text-text-primary">{{ balance() | currency }}</span>
          </p>
        </div>

        @if (data.notes.length === 0) {
          <p class="text-xs text-text-secondary italic">
            Esta factura no tiene notas crédito ni débito.
          </p>
        } @else {
          <ul class="space-y-2">
            @for (note of data.notes; track note.id) {
              <li class="rounded-card border border-border bg-surface p-3 text-xs space-y-1">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <a
                    class="font-medium text-primary hover:underline"
                    [routerLink]="['/super-admin/fiscal/invoicing/platform-invoices', note.id]"
                    (click)="noteOpened.emit(note.id)"
                  >
                    {{ typeLabel(note.document_type) }} {{ note.document_number ?? 'sin número' }}
                  </a>
                  <span
                    class="inline-flex items-center rounded-full border px-2 py-0.5 font-medium"
                    [class]="statusClasses(note.dian_status)"
                  >
                    {{ statusLabel(note.dian_status) }}
                  </span>
                </div>
                <div class="flex flex-wrap justify-between gap-2 text-text-secondary">
                  <span>{{ conceptLabel(note.document_type, note.note_concept_code) }}</span>
                  <span>
                    {{ note.created_at | date: 'mediumDate' }} ·
                    <span class="font-medium text-text-primary">{{ toNum(note.total) | currency }}</span>
                  </span>
                </div>
              </li>
            }
          </ul>
        }
      </section>
    }
  `,
})
export class PlatformInvoiceNotesSectionComponent {
  readonly info = input<PlatformInvoiceNotesInfo | null>(null);
  readonly noteOpened = output<number>();

  readonly balance = computed(() => toNumber(this.info()?.credit_balance));
  readonly toNum = toNumber;
  readonly statusLabel = transmissionStatusLabel;
  readonly statusClasses = transmissionStatusBadgeClasses;

  typeLabel(type: string): string {
    return type === 'credit_note' ? 'Nota crédito' : 'Nota débito';
  }

  conceptLabel(type: string, code: string | null): string {
    if (!code) return 'Sin concepto';
    const list = type === 'credit_note' ? DIAN_CREDIT_NOTE_CONCEPTS : DIAN_DEBIT_NOTE_CONCEPTS;
    return list.find((c) => c.code === code)?.label ?? `Concepto ${code}`;
  }
}
