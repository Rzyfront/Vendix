import {
  Component,
  Input,
  Output,
  EventEmitter,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ButtonComponent,
  IconComponent,
} from '../../../../../../shared/components/index';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import { DispatchNote, DispatchNoteStatus } from '../../interfaces/dispatch-note.interface';

const STATUS_LABELS: Record<DispatchNoteStatus, string> = {
  draft: 'Borrador',
  confirmed: 'Confirmada',
  delivered: 'Entregada',
  invoiced: 'Facturada',
  voided: 'Anulada',
};

const STATUS_COLORS: Record<DispatchNoteStatus, string> = {
  draft: 'bg-gray-100 text-gray-700',
  confirmed: 'bg-blue-100 text-blue-700',
  delivered: 'bg-emerald-100 text-emerald-700',
  invoiced: 'bg-purple-100 text-purple-700',
  voided: 'bg-red-100 text-red-700',
};

@Component({
  selector: 'app-dispatch-note-detail',
  standalone: true,
  imports: [
    CommonModule,
    ButtonComponent,
    IconComponent,
  ],
  templateUrl: './dispatch-note-detail.component.html',
})
export class DispatchNoteDetailComponent {
  private currencyService = inject(CurrencyFormatService);

  @Input() dispatch_note!: DispatchNote;

  @Output() confirmAction = new EventEmitter<DispatchNote>();
  @Output() deliverAction = new EventEmitter<DispatchNote>();
  @Output() voidAction = new EventEmitter<DispatchNote>();
  @Output() invoiceAction = new EventEmitter<DispatchNote>();
  @Output() printAction = new EventEmitter<DispatchNote>();
  @Output() backAction = new EventEmitter<void>();

  getStatusLabel(status: DispatchNoteStatus): string {
    return STATUS_LABELS[status] || status;
  }

  getStatusClasses(status: DispatchNoteStatus): Record<string, boolean> {
    const color = STATUS_COLORS[status] || 'bg-gray-100 text-gray-700';
    const classes: Record<string, boolean> = {};
    color.split(' ').forEach(c => classes[c] = true);
    return classes;
  }

  get can_confirm(): boolean {
    return this.dispatch_note?.status === 'draft';
  }

  get can_deliver(): boolean {
    return this.dispatch_note?.status === 'confirmed';
  }

  get can_void(): boolean {
    return this.dispatch_note?.status === 'confirmed';
  }

  get can_invoice(): boolean {
    return this.dispatch_note?.status === 'delivered';
  }

  get can_print(): boolean {
    return ['delivered', 'invoiced'].includes(this.dispatch_note?.status);
  }

  formatCurrency(value: any): string {
    const num_value = typeof value === 'string' ? parseFloat(value) : (value || 0);
    return this.currencyService.format(num_value);
  }

  formatDate(date: string | undefined): string {
    if (!date) return '-';
    return new Date(date).toLocaleDateString('es-CO', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  formatDateTime(date: string | undefined): string {
    if (!date) return '-';
    return new Date(date).toLocaleString('es-CO', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  getUserName(user: any): string {
    if (!user) return '-';
    return `${user.first_name || ''} ${user.last_name || ''}`.trim() || '-';
  }
}
