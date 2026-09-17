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
import { TableQrPrintService } from '../../services/table-qr-print.service';

/**
 * Modal que muestra el código QR de una mesa para que el operador
 * lo imprima o descargue. Recibe la mesa vía `input`, llama a
 * `GET /store/tables/:id/qr` y renderiza el PNG data URL retornado
 * por el backend.
 *
 * Patrón zoneless: signals (`signal`/`computed`/`input`/`output`),
 * `@if` en template, sin NgZone/markForCheck. La impresión NO se
 * compone aquí: se delega en `TableQrPrintService`, el emisor único
 * del cartel A4 de marca.
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
  private readonly qrPrint = inject(TableQrPrintService);
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
   * Imprime el cartel A4 de marca de esta mesa delegando en
   * `TableQrPrintService`, el emisor único. Se mantiene el early-return:
   * sin mesa o sin QR cargado no hay nada que mandar al papel.
   */
  onPrint(): void {
    const t = this.table();
    const qr = this.qr();
    if (!t || !qr) return;

    this.qrPrint.printOne(t, qr).catch(() => {
      this.toastService.error('No se pudo imprimir el QR de la mesa');
    });
  }

  /**
   * @deprecated El emisor único es `TableQrPrintService`. Este método ya no
   * tiene llamadores; se conserva por la regla del repo de no borrar código.
   */
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

  /**
   * @deprecated El escape lo hace ahora `TableQrPrintService`. Sin llamadores;
   * se conserva por la regla del repo de no borrar código.
   */
  private escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}