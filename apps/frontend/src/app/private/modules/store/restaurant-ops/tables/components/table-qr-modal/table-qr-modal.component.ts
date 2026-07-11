import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ButtonComponent,
  IconComponent,
  ModalComponent,
  SpinnerComponent,
  ToastService,
} from '../../../../../../../shared/components/index';
import { Table, TableQrResponse } from '../../interfaces';
import { TablesService } from '../../services/tables.service';

/**
 * Modal que muestra el código QR de una mesa para que el operador
 * lo imprima o descargue. Recibe la mesa vía `input`, llama a
 * `GET /store/tables/:id/qr` y renderiza el PNG data URL retornado
 * por el backend.
 *
 * Patrón zoneless: signals (`signal`/`computed`/`input`/`output`),
 * `@if` en template, sin NgZone/markForCheck. La impresión replica
 * el patrón iframe de `PosTicketService.printHTML`.
 */
@Component({
  selector: 'app-table-qr-modal',
  standalone: true,
  imports: [
    CommonModule,
    ModalComponent,
    ButtonComponent,
    IconComponent,
    SpinnerComponent,
  ],
  templateUrl: './table-qr-modal.component.html',
  styleUrl: './table-qr-modal.component.scss',
})
export class TableQrModalComponent {
  private readonly tablesService = inject(TablesService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isOpen = input(false);
  readonly table = input<Table | null>(null);

  readonly isOpenChange = output<boolean>();

  readonly qr = signal<TableQrResponse | null>(null);
  readonly isLoading = signal(false);

  readonly title = computed(() =>
    this.table() ? `QR de la mesa: ${this.table()?.name ?? ''}` : 'QR de la mesa',
  );

  readonly publicUrl = computed(() => this.qr()?.public_url ?? null);
  readonly qrDataUrl = computed(() => this.qr()?.qr_data_url ?? null);

  constructor() {
    // Carga el QR cada vez que se abre el modal o cambia la mesa.
    effect(() => {
      const open = this.isOpen();
      const t = this.table();
      if (open && t) {
        this.loadQr(t.id);
      } else if (!open) {
        this.qr.set(null);
      }
    });
  }

  private loadQr(id: number): void {
    this.isLoading.set(true);
    this.qr.set(null);
    this.tablesService
      .getQr(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.qr.set(res);
          this.isLoading.set(false);
        },
        error: (err: unknown) => {
          this.isLoading.set(false);
          this.toastService.error(
            typeof err === 'string' ? err : 'Error al obtener el QR de la mesa',
          );
        },
      });
  }

  onCancel(): void {
    this.isOpenChange.emit(false);
  }

  /**
   * Imprime el QR actual vía un iframe oculto (patrón de
   * `PosTicketService.printHTML`). Genera un documento A4 centrado con
   * el nombre de la mesa, el QR y la URL pública.
   */
  onPrint(): void {
    const t = this.table();
    const dataUrl = this.qrDataUrl();
    const url = this.publicUrl();
    if (!t || !dataUrl || !url) return;

    const html = `
      <div style="font-family: Arial, sans-serif; text-align: center; padding: 24px;">
        <h2 style="margin: 0 0 8px 0; font-size: 22px;">${this.escapeHtml(t.name)}</h2>
        ${t.zone ? `<p style="margin: 0 0 16px 0; font-size: 14px; color: #555;">Zona: ${this.escapeHtml(t.zone)}</p>` : ''}
        <img src="${dataUrl}" style="width: 280px; height: 280px; margin: 16px auto;" />
        <p style="margin: 16px 0 4px 0; font-size: 13px; font-weight: 600;">Escanea para ver la carta y pedir</p>
        <p style="margin: 4px 0 0 0; font-size: 11px; color: #666; word-break: break-all;">${this.escapeHtml(url)}</p>
      </div>
    `;
    this.printHTML(html);
  }

  private printHTML(html: string): void {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = 'none';
    iframe.style.opacity = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (doc) {
      doc.open();
      doc.write(`
        <html>
          <head>
            <title>QR Mesa</title>
            <style>
              body { margin: 0; padding: 24px; background: #fff; }
              @media print { body { padding: 0; } }
            </style>
          </head>
          <body>${html}</body>
        </html>
      `);
      doc.close();

      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    }

    setTimeout(() => iframe.remove(), 1000);
  }

  private escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}