import {
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  model,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import {
  ButtonComponent,
  IconComponent,
  InputComponent,
  ModalComponent,
  SelectorComponent,
  ToastService,
} from '../../../../../../shared/components';
import { SelectorOption } from '../../../../../../shared/components/selector/selector.component';
import { ReservationsService } from '../../services/reservations.service';
import { toLocalDateString } from '../../../../../../shared/utils/date.util';

const STATUS_OPTIONS: SelectorOption[] = [
  { value: 'pending', label: 'Pendiente' },
  { value: 'confirmed', label: 'Confirmada' },
  { value: 'arriving', label: 'En sala' },
  { value: 'attending', label: 'Atendiendo' },
  { value: 'in_progress', label: 'En progreso' },
  { value: 'completed', label: 'Completada' },
  { value: 'cancelled', label: 'Cancelada' },
  { value: 'no_show', label: 'No asistió' },
];

/**
 * QUI-975 — export the reservations report to XLSX. The backend
 * generates the file; this modal only collects the range + optional
 * filters and saves the downloaded blob.
 */
@Component({
  selector: 'app-report-export-modal',
  standalone: true,
  imports: [
    FormsModule,
    ModalComponent,
    ButtonComponent,
    IconComponent,
    InputComponent,
    SelectorComponent,
  ],
  templateUrl: './report-export-modal.component.html',
  styleUrls: ['./report-export-modal.component.scss'],
})
export class ReportExportModalComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly reservationsService = inject(ReservationsService);
  private readonly toastService = inject(ToastService);

  readonly isOpen = model<boolean>(false);
  /** Visible calendar range — the default export range. */
  readonly defaultDateFrom = input<string>('');
  readonly defaultDateTo = input<string>('');

  readonly dateFrom = signal('');
  readonly dateTo = signal('');
  readonly status = signal('');
  readonly providerId = signal<number | null>(null);
  readonly productId = signal<number | null>(null);
  readonly providers = signal<SelectorOption[]>([]);
  readonly services = signal<SelectorOption[]>([]);
  readonly exporting = signal(false);
  private listsLoaded = false;

  readonly statusOptions = STATUS_OPTIONS;

  constructor() {
    effect(() => {
      if (!this.isOpen()) return;
      this.dateFrom.set(
        this.defaultDateFrom() || toLocalDateString(new Date()),
      );
      this.dateTo.set(this.defaultDateTo() || toLocalDateString(new Date()));
      this.status.set('');
      this.providerId.set(null);
      this.productId.set(null);
      if (!this.listsLoaded) {
        this.listsLoaded = true;
        this.loadLists();
      }
    });
  }

  onModalOpenChange(open: boolean): void {
    this.isOpen.set(open);
  }

  onCancel(): void {
    this.isOpen.set(false);
  }

  onDownload(): void {
    const from = this.dateFrom();
    const to = this.dateTo();
    if (!from || !to) {
      this.toastService.error('Elige el rango de fechas a exportar.');
      return;
    }
    if (from > to) {
      this.toastService.error('La fecha inicial no puede ser mayor que la final.');
      return;
    }
    this.exporting.set(true);
    this.reservationsService
      .exportBookingsReport({
        date_from: from,
        date_to: to,
        status: this.status() || undefined,
        provider_id: this.providerId() ?? undefined,
        product_id: this.productId() ?? undefined,
      })
      .pipe(finalize(() => this.exporting.set(false)))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => this.saveBlob(response),
        error: (err) => this.showBlobError(err),
      });
  }

  private loadLists(): void {
    this.reservationsService
      .getProviders()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (providers) =>
          this.providers.set(
            (providers ?? []).map((p) => ({
              value: p.id,
              label: p.display_name || p.employee?.first_name || `Profesional ${p.id}`,
            })),
          ),
        error: () => this.providers.set([]),
      });
    this.reservationsService
      .getBookableServices()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (services) =>
          this.services.set(
            (services ?? []).map((s) => ({ value: s.id, label: s.name })),
          ),
        error: () => this.services.set([]),
      });
  }

  private saveBlob(response: {
    body: Blob | null;
    headers: { get(name: string): string | null };
  }): void {
    const blob = response.body;
    if (!blob || blob.size === 0) {
      this.toastService.error('No hay reservas para exportar en este rango.');
      return;
    }
    const disposition = response.headers.get('Content-Disposition') ?? '';
    const match = /filename="?([^";]+)"?/i.exec(disposition);
    const filename = match?.[1] ?? `reservas_${this.dateFrom()}.xlsx`;
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    window.URL.revokeObjectURL(url);
    this.toastService.success('Reporte descargado.');
    this.isOpen.set(false);
  }

  private async showBlobError(err: unknown): Promise<void> {
    let message = 'No se pudo exportar el reporte.';
    try {
      const raw = (err as { error?: unknown })?.error;
      const text =
        raw instanceof Blob
          ? await raw.text()
          : typeof raw === 'string'
            ? raw
            : '';
      if (text) {
        const parsed = JSON.parse(text) as { message?: unknown };
        if (typeof parsed?.message === 'string' && parsed.message.trim()) {
          message = parsed.message;
        }
      }
    } catch {
      // Keep the default message.
    }
    this.toastService.error(message);
  }
}
