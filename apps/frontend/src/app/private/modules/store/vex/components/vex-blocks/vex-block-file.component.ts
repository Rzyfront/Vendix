import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import { StoreSettingsFacade } from '../../../../../../core/store/store-settings/store-settings.facade';
import { VexFileSpec, VexUiBlock } from '../../models/vex.models';

/**
 * Renders a `file` block (Excel exports, PDFs, generated documents).
 *
 * Download goes through the signed read URL the backend minted for this turn.
 * The link opens in a new tab with `rel="noopener"`; the URL is never written
 * to storage.
 */
@Component({
  selector: 'vendix-vex-block-file',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 flex items-center gap-3"
      aria-label="Archivo de Vex"
    >
      <span
        class="w-11 h-11 shrink-0 rounded-xl grid place-items-center bg-[rgba(var(--color-primary-rgb,46,204,113),0.12)] text-[var(--color-primary)]"
        aria-hidden="true"
      >
        <app-icon [name]="icon()" [size]="22"></app-icon>
      </span>
      <div class="flex-1 min-w-0">
        <p class="text-sm font-medium text-[var(--color-text-primary)] truncate">
          {{ filename() }}
        </p>
        @if (meta_line()) {
          <p class="text-xs text-[var(--color-text-secondary)]">{{ meta_line() }}</p>
        }
      </div>
      @if (url()) {
        <a
          [href]="url()"
          target="_blank"
          rel="noopener"
          download
          class="shrink-0 min-h-10 inline-flex items-center gap-2 px-4 rounded-xl bg-[var(--color-primary)] text-[var(--color-text-on-primary)] text-sm font-medium hover:opacity-90"
        >
          <app-icon name="download" [size]="16"></app-icon>
          Descargar
        </a>
      } @else {
        <span class="shrink-0 text-xs text-[var(--color-text-secondary)]">
          Enlace expirado
        </span>
      }
    </section>
  `,
})
export class VexBlockFileComponent {
  private readonly settingsFacade = inject(StoreSettingsFacade);
  private readonly currencyFormat = inject(CurrencyFormatService);

  readonly block = input.required<VexUiBlock>();

  /** Store-driven `Intl` locale, same rule as the KPI/table blocks. */
  private readonly number_locale = computed(() =>
    storeNumberLocale(
      this.settingsFacade.settings()?.general?.language,
      this.currencyFormat.currencyFormatStyle(),
      this.currencyFormat.resolution() === 'resolved',
    ),
  );

  readonly spec = computed(() => this.block().spec as VexFileSpec);

  readonly url = computed(() => {
    const url = this.block().data['url'];
    return typeof url === 'string' && url ? url : '';
  });

  readonly filename = computed(() => {
    const from_spec = this.spec().filename;
    if (from_spec) return from_spec;
    const from_data = this.block().data['filename'];
    return typeof from_data === 'string' && from_data ? from_data : 'Archivo';
  });

  readonly meta_line = computed(() => {
    const parts: string[] = [];
    const mime = this.spec().mime_type ?? this.block().data['mime_type'];
    if (typeof mime === 'string' && mime) parts.push(mime);
    const size = this.block().data['size_bytes'];
    if (typeof size === 'number' && size > 0) parts.push(formatBytes(size, this.number_locale()));
    return parts.join(' · ');
  });

  readonly icon = computed(() => {
    const mime = String(
      this.spec().mime_type ?? this.block().data['mime_type'] ?? '',
    ).toLowerCase();
    const name = this.filename().toLowerCase();
    if (mime.includes('pdf') || name.endsWith('.pdf')) return 'file-text';
    if (mime.includes('sheet') || mime.includes('excel') || /\.(xlsx?|csv)$/.test(name)) {
      return 'table';
    }
    if (mime.startsWith('image/')) return 'image';
    return 'file';
  });

  constructor() {
    void this.currencyFormat.loadCurrency();
  }
}

/**
 * Store-driven `Intl` locale for plain numbers. Mirrors the KPI/table blocks:
 * the resolved currency format style wins; before it resolves, the store
 * language decides.
 */
function storeNumberLocale(
  language: string | undefined,
  format_style: string,
  resolved: boolean,
): string {
  if (resolved) {
    switch (format_style) {
      case 'dot_comma':
        return 'de-DE';
      case 'space_comma':
        return 'fr-FR';
      default:
        return 'en-US';
    }
  }
  return language === 'en' ? 'en-US' : 'es-CO';
}

function formatBytes(bytes: number, locale: string): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toLocaleString(locale, { maximumFractionDigits: 1 })} ${units[unit]}`;
}
