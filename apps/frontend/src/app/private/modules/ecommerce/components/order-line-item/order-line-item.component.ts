import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { formatVariantAttributes } from '../../../../../shared/utils/variant-attributes.util';
import type { CartItem } from '../../services/cart.service';
import {
  CurrencyPipe,
  CurrencyFormatService,
} from '../../../../../shared/pipes/currency';

/** Modelo neutro de una línea de pedido/carrito para presentación. */
export interface OrderLineItemView {
  image?: string | null;
  title: string;
  variantLabel?: string | null;
  sku?: string | null;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  note?: string | null;
  badges?: string[];
}

export const ORDER_LINE_NOTE_MAX_LENGTH = 200;

/**
 * Adapta una línea del carrito al modelo neutro. El label de variante nunca
 * es un objeto/JSON: si `variant.name` viene vacío o con forma de JSON se
 * arma desde `variant.attributes` con `formatVariantAttributes`.
 */
export function cartItemToLineView(item: CartItem): OrderLineItemView {
  const rawName = item.variant?.name?.trim() ?? '';
  const nameLooksRaw = rawName.startsWith('{') || rawName.startsWith('[');
  const variantLabel =
    (rawName && !nameLooksRaw
      ? rawName
      : formatVariantAttributes(nameLooksRaw ? rawName : item.variant?.attributes, ' · ')) ||
    null;

  const badges: string[] = [];
  if (item.price_tier?.label) {
    badges.push(
      item.price_tier.units_per_package > 1
        ? `${item.price_tier.label} (${item.price_tier.units_per_package} und)`
        : item.price_tier.label,
    );
  }
  if (
    item.product.product_type === 'service' ||
    item.product.requires_booking === true
  ) {
    const mins = item.product.service_duration_minutes;
    badges.push(mins && mins > 0 ? `Servicio · ${mins} min` : 'Servicio');
  }

  return {
    image: item.product.image_url,
    title: item.product.name,
    variantLabel,
    sku: item.variant?.sku || item.product.sku || null,
    unitPrice: Number(item.unit_price) || 0,
    quantity: item.quantity,
    lineTotal: Number(item.total_price) || 0,
    note: item.notes ?? null,
    badges,
  };
}

/**
 * Línea de pedido de presentación pura (carrito, dropdown del header y
 * resumen del checkout). El padre es dueño de toda mutación: este componente
 * sólo emite `quantityChange` / `remove` / `noteChange`.
 *
 * Dinero con el `CurrencyPipe` de Vendix; el `data-currency` mantiene el pipe
 * impuro reactivo bajo OnPush cuando la moneda del tenant resuelve tarde.
 */
@Component({
  selector: 'app-order-line-item',
  standalone: true,
  imports: [IconComponent, CurrencyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block min-w-0' },
  template: `
    <article
      class="flex min-w-0 items-start rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] transition-opacity"
      [class.gap-3]="!compact()"
      [class.p-3]="!compact()"
      [class.gap-2]="compact()"
      [class.p-2]="compact()"
      [class.opacity-60]="updating()"
      [class.pointer-events-none]="updating()"
      [attr.data-currency]="currencyCode()"
      [attr.aria-busy]="updating()"
    >
      <!-- Miniatura -->
      <div
        class="relative shrink-0 overflow-hidden rounded-lg border border-[var(--color-border)] bg-slate-100"
        [class.h-16]="!compact()"
        [class.w-16]="!compact()"
        [class.h-12]="compact()"
        [class.w-12]="compact()"
      >
        @if (item().image) {
          <img
            [src]="item().image"
            [alt]="item().title"
            loading="lazy"
            class="absolute inset-0 h-full w-full object-cover"
          />
        } @else {
          <div
            class="absolute inset-0 flex items-center justify-center text-slate-400"
          >
            <app-icon name="image" [size]="compact() ? 16 : 22"></app-icon>
          </div>
        }
      </div>

      <!-- Cuerpo -->
      <div class="min-w-0 flex-1">
        <div class="flex items-start justify-between gap-2">
          <h4
            class="line-clamp-2 min-w-0 font-semibold leading-snug text-slate-900"
            [class.text-sm]="!compact()"
            [class.text-xs]="compact()"
          >
            {{ item().title }}
          </h4>
          @if (isEditable()) {
            <button
              type="button"
              class="-mr-1 -mt-1 flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed"
              [disabled]="updating()"
              [attr.aria-label]="'Eliminar ' + item().title"
              title="Eliminar"
              (click)="remove.emit()"
            >
              <app-icon name="trash-2" [size]="16"></app-icon>
            </button>
          }
        </div>

        @if (item().variantLabel) {
          <p class="mt-0.5 truncate text-xs text-slate-500">
            {{ item().variantLabel }}
          </p>
        }

        @if (badges().length > 0) {
          <div class="mt-1 flex flex-wrap gap-1">
            @for (b of badges(); track b) {
              <span
                class="rounded border border-[var(--color-border)] bg-slate-100 px-1.5 py-px text-[10px] font-medium leading-tight text-slate-600"
                >{{ b }}</span
              >
            }
          </div>
        }

        @if (!compact() && item().sku) {
          <p class="mt-0.5 truncate text-[11px] text-slate-400">
            SKU: {{ item().sku }}
          </p>
        }

        <!-- Nota -->
        @if (noteEditable()) {
          @if (editingNote()) {
            <div class="mt-2">
              <textarea
                class="block w-full resize-none rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-xs text-slate-900 outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                rows="2"
                [attr.maxlength]="noteMax"
                placeholder="Ej: sin cebolla, empacar para regalo"
                [attr.aria-label]="'Nota para ' + item().title"
                [value]="draft()"
                (input)="onDraftInput($event)"
              ></textarea>
              <div class="mt-1 flex items-center justify-between gap-2">
                <span class="text-[10px] text-slate-400"
                  >{{ draft().length }}/{{ noteMax }}</span
                >
                <div class="flex items-center gap-1.5">
                  <button
                    type="button"
                    class="cursor-pointer rounded-md px-2 py-1 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
                    (click)="cancelNote()"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    class="cursor-pointer rounded-md bg-primary px-2.5 py-1 text-xs font-semibold text-white transition-opacity hover:opacity-90"
                    (click)="saveNote()"
                  >
                    Guardar
                  </button>
                </div>
              </div>
            </div>
          } @else if (item().note) {
            <button
              type="button"
              class="mt-1.5 inline-flex max-w-full cursor-pointer items-center gap-1 rounded-md border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-left text-[11px] font-medium leading-tight text-primary"
              [attr.aria-label]="'Editar nota de ' + item().title"
              title="Editar nota"
              (click)="startNote()"
            >
              <app-icon name="pencil" [size]="10" class="shrink-0"></app-icon>
              <span class="truncate">{{ item().note }}</span>
            </button>
          } @else {
            <button
              type="button"
              class="mt-1.5 inline-flex cursor-pointer items-center gap-0.5 rounded-md border border-transparent px-1.5 py-0.5 text-[11px] font-medium leading-none text-slate-400 transition-colors hover:border-[var(--color-border)] hover:bg-slate-100 hover:text-slate-700"
              [attr.aria-label]="'Agregar nota a ' + item().title"
              title="Agregar nota"
              (click)="startNote()"
            >
              <app-icon name="plus" [size]="10"></app-icon>
              <span>Nota</span>
            </button>
          }
        } @else if (item().note) {
          <p class="mt-1 break-words text-[11px] italic text-slate-500">
            {{ item().note }}
          </p>
        }

        <!-- Pie: stepper / cantidad + precios -->
        <div class="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          @if (isEditable()) {
            <div
              class="inline-flex items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]"
            >
              <button
                type="button"
                class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-l-lg text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                [disabled]="updating() || item().quantity <= 1"
                aria-label="Disminuir cantidad"
                (click)="changeBy(-1)"
              >
                <app-icon name="minus" [size]="14"></app-icon>
              </button>
              <span
                class="min-w-[2rem] px-1 text-center text-sm font-semibold tabular-nums text-slate-900"
                aria-live="polite"
                >{{ item().quantity }}</span
              >
              <button
                type="button"
                class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-r-lg text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                [disabled]="updating() || atMax()"
                aria-label="Aumentar cantidad"
                (click)="changeBy(1)"
              >
                <app-icon name="plus" [size]="14"></app-icon>
              </button>
            </div>
          } @else {
            <span class="text-xs font-medium text-slate-500"
              >× {{ item().quantity }}</span
            >
          }

          <div class="ml-auto flex flex-col items-end leading-tight">
            @if (item().quantity > 1) {
              <span class="text-[11px] text-slate-500">
                {{ item().unitPrice | currency }} c/u
              </span>
            }
            <span
              class="font-bold tabular-nums text-slate-900"
              [class.text-sm]="!compact()"
              [class.text-xs]="compact()"
              >{{ item().lineTotal | currency }}</span
            >
          </div>
        </div>
      </div>
    </article>
  `,
})
export class OrderLineItemComponent {
  readonly item = input.required<OrderLineItemView>();
  readonly mode = input<'editable' | 'readonly'>('readonly');
  readonly updating = input<boolean>(false);
  readonly maxQuantity = input<number | null>(null);
  readonly noteEditable = input<boolean>(false);
  readonly compact = input<boolean>(false);

  readonly quantityChange = output<number>();
  readonly remove = output<void>();
  readonly noteChange = output<string | null>();

  private readonly currencyFormat = inject(CurrencyFormatService);
  /** Leído en la plantilla (`data-currency`) para re-render bajo OnPush. */
  protected readonly currencyCode = this.currencyFormat.currencyCode;

  protected readonly noteMax = ORDER_LINE_NOTE_MAX_LENGTH;
  protected readonly editingNote = signal(false);
  protected readonly draft = signal('');

  protected readonly isEditable = computed(() => this.mode() === 'editable');
  protected readonly badges = computed(() => this.item().badges ?? []);
  protected readonly atMax = computed(() => {
    const max = this.maxQuantity();
    return !!max && this.item().quantity >= max;
  });

  constructor() {
    this.currencyFormat.loadCurrency();
  }

  protected changeBy(delta: number): void {
    const next = this.item().quantity + delta;
    const max = this.maxQuantity();
    if (next < 1 || (max && next > max)) return;
    this.quantityChange.emit(next);
  }

  protected startNote(): void {
    this.draft.set(this.item().note ?? '');
    this.editingNote.set(true);
  }

  protected cancelNote(): void {
    this.editingNote.set(false);
  }

  protected onDraftInput(event: Event): void {
    const value = (event.target as HTMLTextAreaElement).value;
    this.draft.set(value.slice(0, ORDER_LINE_NOTE_MAX_LENGTH));
  }

  protected saveNote(): void {
    const clean = this.draft().trim();
    this.editingNote.set(false);
    const next = clean === '' ? null : clean;
    if (next === (this.item().note ?? null)) return;
    this.noteChange.emit(next);
  }
}
