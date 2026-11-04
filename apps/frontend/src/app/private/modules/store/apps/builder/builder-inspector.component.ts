import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { BuilderListItem, blockDef, readListItems } from './builder-blocks';
import type {
  BuilderBlock,
  BuilderCatalog,
  BuilderFieldDef,
  BuilderListFieldDef,
  BuilderScalarFieldDef,
} from './builder.types';

/** An edit of one prop of one block, applied by the editor with `setBlockProp`. */
export interface BuilderPropChange {
  blockId: string;
  key: string;
  value: unknown;
}

/**
 * F6-A — field inspector of the builder (engine, app-agnostic). It renders the
 * fields the catalog declares for the selected block: text and long text with
 * a character counter, https links, and repeatable lists edited item by item
 * (add, remove, reorder). Lists are read with the catalog aliases and written
 * back with the canonical keys; blank items are dropped on write.
 */
@Component({
  selector: 'app-builder-inspector',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (block(); as b) {
      @if (def(); as d) {
        <div class="space-y-4 p-4" data-testid="builder-inspector">
          <header class="flex items-start gap-2.5">
            <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-background)] text-[var(--color-primary)]">
              <app-icon [name]="d.icon" [size]="18" />
            </span>
            <div class="min-w-0">
              <h2 class="text-sm font-semibold text-[var(--color-text-primary)]">{{ d.label }}</h2>
              <p class="text-xs text-[var(--color-text-secondary)]">{{ d.description }}</p>
            </div>
          </header>

          @if (b.hidden) {
            <p class="flex items-center gap-2 rounded-lg bg-[var(--color-background)] px-3 py-2 text-xs text-[var(--color-text-secondary)]">
              <app-icon name="eye-off" [size]="14" /> Sección oculta: se guarda en el borrador pero no se publica.
            </p>
          }
          @if (d.liveData) {
            <p class="flex items-start gap-2 rounded-lg bg-[var(--color-background)] px-3 py-2 text-xs text-[var(--color-text-secondary)]" data-testid="builder-live-data">
              <app-icon name="info" [size]="14" class="mt-0.5 shrink-0" /> {{ d.liveData }}
            </p>
          }

          @for (field of d.fields; track field.key) {
            @if (isList(field)) {
              <fieldset class="space-y-2" [attr.data-field]="field.key">
                <legend class="flex w-full items-center justify-between text-xs font-semibold text-[var(--color-text-primary)]">
                  <span>{{ field.label }}</span>
                  <span class="font-normal text-[var(--color-text-secondary)]">{{ items(b, field).length }} / {{ field.max }}</span>
                </legend>
                @for (item of items(b, field); track $index; let i = $index; let first = $first; let last = $last) {
                  <div class="space-y-2 rounded-lg border border-[var(--color-border)] p-2.5" data-testid="builder-list-item">
                    <div class="flex items-center justify-between">
                      <span class="text-[11px] font-medium text-[var(--color-text-secondary)]">{{ field.itemLabel }} {{ i + 1 }}</span>
                      <div class="flex items-center">
                        <button type="button" class="rounded p-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-background)] disabled:opacity-30"
                                [disabled]="first" (click)="moveItem(b, field, i, i - 1)" [attr.aria-label]="'Subir ' + field.itemLabel">
                          <app-icon name="chevron-up" [size]="13" />
                        </button>
                        <button type="button" class="rounded p-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-background)] disabled:opacity-30"
                                [disabled]="last" (click)="moveItem(b, field, i, i + 1)" [attr.aria-label]="'Bajar ' + field.itemLabel">
                          <app-icon name="chevron-down" [size]="13" />
                        </button>
                        <button type="button" class="rounded p-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-background)] hover:text-[var(--color-error,#dc2626)]"
                                (click)="removeItem(b, field, i)" [attr.aria-label]="'Quitar ' + field.itemLabel" data-testid="builder-list-remove">
                          <app-icon name="trash-2" [size]="13" />
                        </button>
                      </div>
                    </div>
                    @for (sub of field.item; track sub.key) {
                      <label class="block">
                        <span class="mb-1 flex justify-between text-[11px] text-[var(--color-text-secondary)]">
                          <span>{{ sub.label }}</span>
                          @if (sub.kind !== 'url') { <span>{{ (item[sub.key] ?? '').length }}/{{ sub.max }}</span> }
                        </span>
                        @if (sub.kind === 'textarea') {
                          <textarea rows="2" [attr.maxlength]="sub.max" [attr.placeholder]="sub.placeholder ?? null"
                                    class="w-full resize-y rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-sm"
                                    [value]="item[sub.key] ?? ''" (input)="setItem(b, field, i, sub.key, $any($event.target).value)"></textarea>
                        } @else {
                          <input [type]="sub.kind === 'url' ? 'url' : 'text'" [attr.maxlength]="sub.kind === 'url' ? null : sub.max"
                                 [attr.placeholder]="sub.placeholder ?? null"
                                 class="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-sm"
                                 [class.border-[var(--color-error,#dc2626)]]="urlError(item[sub.key], sub)"
                                 [value]="item[sub.key] ?? ''" (input)="setItem(b, field, i, sub.key, $any($event.target).value)" />
                          @if (urlError(item[sub.key], sub)) {
                            <span class="mt-1 block text-[11px] text-[var(--color-error,#dc2626)]">Usa un enlace que empiece por https://</span>
                          }
                        }
                      </label>
                    }
                  </div>
                } @empty {
                  @if (field.emptyHint) {
                    <p class="rounded-lg border border-dashed border-[var(--color-border)] px-3 py-2.5 text-xs text-[var(--color-text-secondary)]">{{ field.emptyHint }}</p>
                  }
                }
                <button type="button" class="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--color-primary)] disabled:opacity-40"
                        [disabled]="items(b, field).length >= field.max" (click)="addItem(b, field)" data-testid="builder-list-add">
                  <app-icon name="plus" [size]="13" /> Agregar {{ field.itemLabel.toLowerCase() }}
                </button>
              </fieldset>
            } @else {
              <label class="block" [attr.data-field]="field.key">
                <span class="mb-1 flex justify-between text-xs font-semibold text-[var(--color-text-primary)]">
                  <span>{{ field.label }}</span>
                  @if (field.kind !== 'url') {
                    <span class="font-normal text-[var(--color-text-secondary)]">{{ text(b, field.key).length }}/{{ field.max }}</span>
                  }
                </span>
                @if (field.kind === 'textarea') {
                  <textarea rows="4" [attr.maxlength]="field.max" [attr.placeholder]="field.placeholder ?? null"
                            class="w-full resize-y rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
                            [value]="text(b, field.key)" (input)="setText(b, field.key, $any($event.target).value)"></textarea>
                } @else {
                  <input [type]="field.kind === 'url' ? 'url' : 'text'" [attr.maxlength]="field.kind === 'url' ? null : field.max"
                         [attr.placeholder]="field.placeholder ?? null"
                         class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
                         [class.border-[var(--color-error,#dc2626)]]="urlError(text(b, field.key), field)"
                         [value]="text(b, field.key)" (input)="setText(b, field.key, $any($event.target).value)" />
                }
                @if (urlError(text(b, field.key), field)) {
                  <span class="mt-1 block text-[11px] text-[var(--color-error,#dc2626)]">Usa un enlace que empiece por https://</span>
                } @else if (field.hint) {
                  <span class="mt-1 block text-[11px] text-[var(--color-text-secondary)]">{{ field.hint }}</span>
                }
              </label>
            }
          }
        </div>
      } @else {
        <p class="p-4 text-sm text-[var(--color-text-secondary)]">Esta sección no tiene campos editables aquí.</p>
      }
    } @else {
      <div class="flex h-full flex-col items-center justify-center p-6 text-center" data-testid="builder-inspector-empty">
        <app-icon name="pencil" [size]="22" class="text-[var(--color-text-secondary)]" />
        <p class="mt-2 text-sm font-medium text-[var(--color-text-primary)]">Elige una sección para editarla</p>
        <p class="mt-1 text-xs text-[var(--color-text-secondary)]">Haz clic en una sección de la lista o directamente en la vista previa.</p>
      </div>
    }
  `,
})
export class BuilderInspectorComponent {
  readonly catalog = input.required<BuilderCatalog>();
  readonly block = input<BuilderBlock | null>(null);

  readonly propChange = output<BuilderPropChange>();

  readonly def = computed(() => {
    const b = this.block();
    return b ? blockDef(this.catalog(), b.type) ?? null : null;
  });

  isList(field: BuilderFieldDef): field is BuilderListFieldDef {
    return field.kind === 'list';
  }

  text(block: BuilderBlock, key: string): string {
    const value = block.props[key];
    return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  }

  items(block: BuilderBlock, field: BuilderListFieldDef): BuilderListItem[] {
    return readListItems(field, block.props[field.key]);
  }

  urlError(value: string | undefined, field: BuilderScalarFieldDef): boolean {
    if (field.kind !== 'url') return false;
    const v = (value ?? '').trim();
    return v.length > 0 && !/^https:\/\/\S+$/i.test(v);
  }

  setText(block: BuilderBlock, key: string, value: string): void {
    this.propChange.emit({ blockId: block.id, key, value });
  }

  setItem(block: BuilderBlock, field: BuilderListFieldDef, index: number, key: string, value: string): void {
    const items = this.items(block, field);
    items[index] = { ...items[index], [key]: value };
    this.writeItems(block, field, items);
  }

  addItem(block: BuilderBlock, field: BuilderListFieldDef): void {
    const items = this.items(block, field);
    if (items.length >= field.max) return;
    items.push(Object.fromEntries(field.item.map((f) => [f.key, ''])));
    this.writeItems(block, field, items);
  }

  removeItem(block: BuilderBlock, field: BuilderListFieldDef, index: number): void {
    const items = this.items(block, field);
    items.splice(index, 1);
    this.writeItems(block, field, items);
  }

  moveItem(block: BuilderBlock, field: BuilderListFieldDef, from: number, to: number): void {
    const items = this.items(block, field);
    if (to < 0 || to >= items.length) return;
    const [item] = items.splice(from, 1);
    items.splice(to, 0, item);
    this.writeItems(block, field, items);
  }

  /**
   * Items are written as typed: an item being filled in must not vanish. The
   * editor drops blank items on save (`cleanBlockLists`).
   */
  private writeItems(block: BuilderBlock, field: BuilderListFieldDef, items: BuilderListItem[]): void {
    this.propChange.emit({ blockId: block.id, key: field.key, value: items });
  }
}
