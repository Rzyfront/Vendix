import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { VexUiBlock } from '../../models/vex.models';
import { VEX_COPY } from '../../vex-copy';
import {
  blockToExportTable,
  exportBlockCsv,
  exportBlockXlsx,
} from './vex-block-export.util';

/**
 * «Exportar» menu shared by table, chart, list and timeline blocks. XLSX/CSV
 * are produced from the same grid the block shows; the PNG option (charts only)
 * is delegated to the parent through `exportImage`, which owns the echarts
 * instance.
 */
@Component({
  selector: 'vendix-vex-block-export-menu',
  standalone: true,
  imports: [ButtonComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'relative inline-block',
    '(keydown.escape)': 'close()',
    '(focusout)': 'onFocusOut($event)',
  },
  template: `
    @if (exportable()) {
      <app-button
        variant="ghost"
        size="sm"
        [ariaLabel]="copy.button_aria"
        [loading]="busy()"
        (clicked)="toggle()"
      >
        <app-icon slot="icon" name="download" [size]="16"></app-icon>
        {{ copy.button }}
      </app-button>
      @if (open()) {
        <div
          role="menu"
          [attr.aria-label]="copy.menu_label"
          class="absolute right-0 z-20 mt-1 min-w-44 rounded-xl border border-border bg-surface p-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            class="w-full min-h-10 px-3 rounded-lg text-left text-sm text-text-primary hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-primary"
            (click)="run('xlsx')"
          >
            {{ copy.xlsx }}
          </button>
          <button
            type="button"
            role="menuitem"
            class="w-full min-h-10 px-3 rounded-lg text-left text-sm text-text-primary hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-primary"
            (click)="run('csv')"
          >
            {{ copy.csv }}
          </button>
          @if (allowImage()) {
            <button
              type="button"
              role="menuitem"
              class="w-full min-h-10 px-3 rounded-lg text-left text-sm text-text-primary hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-primary"
              (click)="run('png')"
            >
              {{ copy.png }}
            </button>
          }
        </div>
      }
      @if (failed()) {
        <p class="absolute right-0 mt-1 text-xs text-error" role="alert">
          {{ copy.failed }}
        </p>
      }
    }
  `,
})
export class VexBlockExportMenuComponent {
  protected readonly copy = VEX_COPY.blocks.export;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly block = input.required<VexUiBlock>();
  readonly allowImage = input(false);
  readonly exportImage = output<void>();

  readonly open = signal(false);
  readonly busy = signal(false);
  readonly failed = signal(false);

  readonly exportable = computed(() => {
    const table = blockToExportTable(this.block());
    return !!table && table.rows.length > 0;
  });

  toggle(): void {
    this.failed.set(false);
    this.open.update((value) => !value);
  }

  close(): void {
    this.open.set(false);
  }

  onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget as Node | null;
    if (next && !this.host.nativeElement.contains(next)) this.close();
  }

  async run(format: 'xlsx' | 'csv' | 'png'): Promise<void> {
    this.close();
    this.failed.set(false);
    try {
      if (format === 'png') {
        this.exportImage.emit();
        return;
      }
      this.busy.set(true);
      if (format === 'csv') exportBlockCsv(this.block());
      else await exportBlockXlsx(this.block());
    } catch {
      this.failed.set(true);
    } finally {
      this.busy.set(false);
    }
  }
}
