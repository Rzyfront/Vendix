import { Component, computed, input, output } from '@angular/core';

import {
  PRINT_FORMATS,
  PRINT_PAGE_GEOMETRY,
  PrintFormat,
} from '../../../../../../../core/models/store-settings.interface';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { PRINT_FORMAT_SHORT_LABELS } from './print-formats.copy';

/**
 * Millimetre height of the CSS page-size keywords that `PRINT_PAGE_GEOMETRY`
 * uses. `letter` and `A4` are fixed by CSS Paged Media at 216 × 279 mm and
 * 210 × 297 mm — the same numbers `PRINT_FORMAT_LABELS` shows the merchant — so
 * reading them here is resolving the contract, not inventing a size.
 */
const PAGE_KEYWORD_HEIGHT_MM: Record<string, number> = {
  letter: 279,
  a4: 297,
};

/**
 * Height of the tallest silhouette, in pixels. Every format is drawn with the
 * same millimetre-to-pixel ruler derived from it, which is the whole point of
 * the chip: an 80 mm roll next to an A4 sheet has to LOOK like the strip it is.
 */
const TALLEST_SILHOUETTE_PX = 60;

/**
 * Page height in millimetres, taken out of the format's own `page_size`.
 *
 * Three shapes appear in `PRINT_PAGE_GEOMETRY`:
 * - `'216mm 140mm'` — both dimensions explicit, the height is read off it;
 * - `'letter'` / `'A4'` — a CSS keyword, resolved through the map above;
 * - `'80mm auto'` — a roll: `auto` is not a height. The paper is continuous and
 *   the sheet grows with the content, so there is no ratio to draw.
 */
function pageHeightMm(format: PrintFormat): number | null {
  const geometry = PRINT_PAGE_GEOMETRY[format];
  if (!geometry || geometry.is_roll) return null;

  const explicit = /^\s*([\d.]+)\s*mm\s+([\d.]+)\s*mm\s*$/.exec(
    geometry.page_size,
  );
  if (explicit) return Number(explicit[2]);

  return PAGE_KEYWORD_HEIGHT_MM[geometry.page_size.trim().toLowerCase()] ?? null;
}

/** Tallest sheet in the catalogue — the reference of the shared ruler. */
const TALLEST_SHEET_MM = Math.max(
  ...PRINT_FORMATS.map((format) => pageHeightMm(format) ?? 0),
);

const PX_PER_MM = TALLEST_SILHOUETTE_PX / TALLEST_SHEET_MM;

export interface FormatSilhouette {
  widthPx: number;
  heightPx: number;
  isRoll: boolean;
  /** `210 × 297 mm` for a sheet, `80 mm de ancho · continuo` for a roll. */
  caption: string;
}

function silhouetteOf(format: PrintFormat): FormatSilhouette {
  const geometry = PRINT_PAGE_GEOMETRY[format];
  const widthMm = geometry?.width_mm ?? 0;
  const heightMm = pageHeightMm(format);
  const isRoll = geometry?.is_roll ?? false;

  return {
    widthPx: Math.round(widthMm * PX_PER_MM),
    // A roll fills the box: it has no end, and cutting it short would draw it as
    // a sheet it is not.
    heightPx:
      heightMm === null
        ? TALLEST_SILHOUETTE_PX
        : Math.round(heightMm * PX_PER_MM),
    isRoll,
    caption: isRoll
      ? `${widthMm} mm · continuo`
      : `${widthMm} × ${heightMm ?? '?'} mm`,
  };
}

/**
 * One paper format, drawn to scale.
 *
 * A `<select>` of five names asks the merchant to know by heart that
 * `half_letter` is the wide short one and that 58 mm is narrower than 80 mm. The
 * silhouette makes the comparison the eye's job instead of memory's.
 */
@Component({
  selector: 'app-print-format-chip',
  standalone: true,
  imports: [IconComponent],
  template: `
    <button
      type="button"
      class="chip"
      [class.chip--selected]="selected()"
      [attr.aria-pressed]="selected()"
      [attr.aria-label]="label() + ', ' + silhouette().caption"
      (click)="picked.emit(format())"
    >
      <span class="chip__stage">
        <span
          class="chip__paper"
          [class.chip__paper--roll]="silhouette().isRoll"
          [style.width.px]="silhouette().widthPx"
          [style.height.px]="silhouette().heightPx"
        ></span>
      </span>

      <span class="chip__label">{{ label() }}</span>
      <span class="chip__caption">{{ silhouette().caption }}</span>

      @if (selected()) {
        <span class="chip__check" aria-hidden="true">
          <app-icon name="check" [size]="12" />
        </span>
      }
    </button>
  `,
  styles: `
    :host {
      display: block;
      flex: 0 0 auto;
    }

    .chip {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.375rem;
      width: 5.75rem;
      padding: 0.5rem 0.375rem 0.5rem;
      border: 1px solid var(--color-border);
      border-radius: 0.75rem;
      background-color: var(--color-background);
      cursor: pointer;
      font: inherit;
      color: var(--color-text-secondary);
      transition:
        border-color 160ms ease,
        background-color 160ms ease,
        color 160ms ease;
    }

    .chip:hover {
      border-color: var(--color-primary);
    }

    .chip:focus-visible {
      outline: 2px solid var(--color-ring);
      outline-offset: 2px;
    }

    .chip--selected {
      border-color: var(--color-primary);
      background-color: rgba(var(--color-primary-rgb), 0.1);
      color: var(--color-text-primary);
    }

    /* Fixed stage so chips of different paper heights keep one baseline and the
       rail does not wobble as the eye scans it. */
    .chip__stage {
      display: flex;
      align-items: flex-end;
      justify-content: center;
      height: 60px;
    }

    .chip__paper {
      display: block;
      border: 1px solid var(--color-text-muted);
      border-radius: 2px;
      background-color: var(--color-surface);
      /* Faint ruled lines: reads as a printed page instead of an empty box. */
      background-image: repeating-linear-gradient(
        to bottom,
        rgba(var(--color-text-muted-rgb), 0.32) 0,
        rgba(var(--color-text-muted-rgb), 0.32) 1px,
        transparent 1px,
        transparent 5px
      );
      background-position: 0 3px;
      background-clip: content-box;
    }

    /* A roll has no bottom edge — the paper continues past the cut. */
    .chip__paper--roll {
      border-bottom: 1px dashed var(--color-text-muted);
      border-bottom-left-radius: 0;
      border-bottom-right-radius: 0;
    }

    .chip--selected .chip__paper {
      border-color: var(--color-primary);
    }

    .chip__label {
      font-size: 0.75rem;
      font-weight: 600;
      line-height: 1.2;
      text-align: center;
    }

    .chip__caption {
      font-size: 0.625rem;
      line-height: 1.2;
      text-align: center;
      color: var(--color-text-muted);
    }

    .chip__check {
      position: absolute;
      top: 0.25rem;
      right: 0.25rem;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 1rem;
      height: 1rem;
      border-radius: 999px;
      background-color: var(--color-primary);
      color: var(--color-text-on-primary);
    }

    @media (prefers-reduced-motion: reduce) {
      .chip {
        transition: none;
      }
    }
  `,
})
export class PrintFormatChipComponent {
  readonly format = input.required<PrintFormat>();
  readonly selected = input(false);

  readonly picked = output<PrintFormat>();

  readonly label = computed(() => PRINT_FORMAT_SHORT_LABELS[this.format()]);
  readonly silhouette = computed(() => silhouetteOf(this.format()));
}
