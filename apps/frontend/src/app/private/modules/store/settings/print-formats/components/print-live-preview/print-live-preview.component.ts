import {
  Component,
  inject,
  input,
  computed,
  signal,
  viewChild,
  ElementRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { ButtonComponent } from '../../../../../../../shared/components/button/button.component';
import { PrintFormatsFacade } from '../../services/print-formats.facade';
import { DocumentPrintService } from '../../../../../../../shared/services/print/document-print.service';
import { MmToPxService } from '../../../../../../../shared/services/print/mm-to-px.service';

@Component({
  selector: 'app-print-live-preview',
  standalone: true,
  imports: [CommonModule, IconComponent, ButtonComponent],
  template: `
    <div class="flex flex-col h-full bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-2xl">
      <!-- Toolbar -->
      <div class="flex items-center justify-between px-4 py-3 bg-slate-950 border-b border-slate-800">
        <div class="flex items-center gap-2">
          <app-icon name="eye" [size]="16" class="text-emerald-400"></app-icon>
          <span class="text-xs font-semibold uppercase tracking-wider text-slate-300">Vista Previa en Vivo</span>
          @if (facade.isPreviewLoading()) {
            <span class="inline-flex items-center gap-1 text-[10px] text-emerald-400 animate-pulse bg-emerald-950/60 px-2 py-0.5 rounded-full border border-emerald-800/40">
              <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> Actualizando...
            </span>
          }
        </div>

        <div class="flex items-center gap-2">
          <!-- Zoom Controls -->
          <div class="flex items-center bg-slate-900 rounded-lg border border-slate-800 p-0.5">
            <button
              type="button"
              (click)="zoomOut()"
              class="px-2 py-1 text-slate-400 hover:text-white text-xs hover:bg-slate-800 rounded transition"
              title="Reducir zoom"
            >
              -
            </button>
            <span class="text-[11px] font-mono text-slate-300 px-1.5">{{ zoomLevel() }}%</span>
            <button
              type="button"
              (click)="zoomIn()"
              class="px-2 py-1 text-slate-400 hover:text-white text-xs hover:bg-slate-800 rounded transition"
              title="Aumentar zoom"
            >
              +
            </button>
            <button
              type="button"
              (click)="resetZoom()"
              class="px-2 py-1 text-slate-400 hover:text-white text-xs hover:bg-slate-800 rounded transition border-l border-slate-800"
              title="Restablecer zoom a 100%"
            >
              Reset
            </button>
          </div>

          <!-- Test Print Button -->
          <app-button
            variant="outline"
            size="sm"
            (clicked)="printTest()"
            class="text-xs"
          >
            <app-icon name="printer" [size]="14" class="mr-1.5"></app-icon>
            Imprimir Prueba
          </app-button>
        </div>
      </div>

      <!-- Preview Sheet Viewport -->
      <div class="flex-1 overflow-auto p-6 flex justify-center items-start bg-slate-950/50">
        <div
          class="transition-transform duration-200 origin-top shadow-2xl rounded-sm"
          [style.transform]="'scale(' + zoomLevel() / 100 + ')'"
          [style.width]="containerWidth()"
          [style.height]="containerHeight()"
        >
          <div class="bg-white text-slate-900 rounded-sm shadow-lg overflow-hidden min-h-[400px]">
            <iframe
              #previewIframe
              id="print-preview-iframe"
              [srcdoc]="facade.previewHtml() || previewPlaceholderHtml"
              class="w-full h-full border-0 min-h-[520px] bg-white block"
              [style.width]="'100%'"
              sandbox="allow-same-origin allow-scripts"
            ></iframe>
          </div>
        </div>
      </div>

      <!-- Paper specs bar -->
      <div class="px-4 py-2 bg-slate-950 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-400">
        <div class="flex items-center gap-3">
          <span>Ancho: <strong class="text-slate-200">{{ facade.previewWidthMm() }}mm</strong></span>
          <span>Tipo: <strong class="text-slate-200">{{ facade.previewIsRoll() ? 'Rollo Continuo (Ticket)' : 'Hoja Suelta' }}</strong></span>
        </div>
        <div class="text-[10px] text-slate-500">Renderizado con motor Vendix HTML5/CSS Print Engine</div>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      height: 100%;
    }
  `],
})
export class PrintLivePreviewComponent {
  /**
   * Marcador que ve el iframe mientras el facade no ha compilado la vista
   * previa. Vive aqui y no en el binding porque el parser de expresiones de
   * Angular no admite `\'` dentro de un literal: la barra invertida no escapa
   * nada, la comilla cierra la cadena y lo que sigue se interpreta como una
   * expresion — de ahi los 7 NG5002 y el `Property 'color' does not exist`,
   * que eran el mismo defecto contado dos veces.
   */
  protected readonly previewPlaceholderHtml =
    '<div style="font-family:sans-serif;padding:20px;color:#888;text-align:center;">Generando vista previa...</div>';

  readonly facade = inject(PrintFormatsFacade);
  private readonly printService = inject(DocumentPrintService);
  private readonly mmToPxService = inject(MmToPxService);

  readonly previewIframe = viewChild<ElementRef<HTMLIFrameElement>>('previewIframe');
  readonly zoomLevel = signal<number>(100);

  readonly containerWidth = computed(() => {
    const isRoll = this.facade.previewIsRoll();
    const widthMm = this.facade.previewWidthMm();
    const box = this.mmToPxService.paperToContainerPx({
      width_mm: widthMm,
      is_roll: isRoll,
    });
    return `${box.width_px}px`;
  });

  readonly containerHeight = computed(() => {
    const isRoll = this.facade.previewIsRoll();
    if (isRoll) return 'auto';
    const widthMm = this.facade.previewWidthMm();
    const box = this.mmToPxService.paperToContainerPx({
      width_mm: widthMm,
      is_roll: false,
    });
    return box.height_px ? `${box.height_px}px` : 'auto';
  });

  zoomIn(): void {
    this.zoomLevel.update((z) => Math.min(z + 10, 160));
  }

  zoomOut(): void {
    this.zoomLevel.update((z) => Math.max(z - 10, 60));
  }

  resetZoom(): void {
    this.zoomLevel.set(100);
  }

  async printTest(): Promise<void> {
    const html = this.facade.previewHtml();
    if (html) {
      await this.printService.printGatewayHtml(html);
    }
  }
}
