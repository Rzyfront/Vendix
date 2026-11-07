import { Component, ElementRef, computed, input, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  ButtonComponent,
  IconComponent,
  InputComponent,
  SelectorComponent,
} from '../../../../../../shared/components/index';
import {
  BasePdfBody,
  BasePdfBox,
  BasePdfField,
  BasePdfPage,
  BasePdfSlot,
} from '../../interfaces/document-template.interfaces';

type Kind = 'field' | 'slot';
interface Selection {
  kind: Kind;
  index: number;
}
interface Drag {
  sel: Selection;
  mode: 'move' | 'resize';
  startX: number;
  startY: number;
  origin: BasePdfBox;
  /** PDF points per screen pixel at the moment the drag began. */
  scale: number;
}

const MIN_SIZE = 10;
const ALIGNS = [
  { value: 'left', label: 'Izquierda' },
  { value: 'center', label: 'Centrado' },
  { value: 'right', label: 'Derecha' },
];

/**
 * Field editor over the real page of the base PDF: draggable boxes positioned
 * in PDF points (from the top-left corner) for the fields and the signature
 * boxes of the selected page.
 */
@Component({
  selector: 'app-template-base-pdf-editor',
  standalone: true,
  imports: [FormsModule, ButtonComponent, IconComponent, InputComponent, SelectorComponent],
  template: `
    <div class="flex flex-col gap-3" data-testid="base-pdf-editor">
      <div class="flex flex-wrap items-center gap-2">
        <input #picker type="file" class="hidden" accept="application/pdf" (change)="onFile($event)" />
        <app-button variant="outline" size="sm" [loading]="uploading()" (clicked)="picker.click()">
          <app-icon name="upload" [size]="14" slot="icon" />
          {{ pages().length > 0 ? 'Cambiar el PDF base' : 'Subir el PDF base' }}
        </app-button>
        @if (pages().length > 0) {
          <app-button variant="outline" size="sm" (clicked)="addField()">
            <app-icon name="file-input" [size]="14" slot="icon" />
            Agregar campo
          </app-button>
          <app-button variant="outline" size="sm" [disabled]="body().signature_slots.length >= 6" (clicked)="addSlot()">
            <app-icon name="pen-line" [size]="14" slot="icon" />
            Agregar casilla de firma
          </app-button>
        }
      </div>

      @if (pages().length === 0) {
        <p class="rounded-xl border border-dashed border-border p-6 text-center text-sm text-text-secondary" data-testid="base-pdf-empty">
          Sube el formato oficial en PDF (máximo 10 páginas) para ubicar encima los campos.
        </p>
      } @else {
        <div class="flex flex-wrap items-center gap-2">
          <app-button variant="outline" size="xsm" ariaLabel="Página anterior" [disabled]="page() <= 1" (clicked)="page.set(page() - 1)">
            <app-icon name="chevron-left" [size]="12" slot="icon" />
          </app-button>
          <span class="text-xs text-text-secondary" role="status">Página {{ page() }} de {{ pages().length }}</span>
          <app-button variant="outline" size="xsm" ariaLabel="Página siguiente" [disabled]="page() >= pages().length" (clicked)="page.set(page() + 1)">
            <app-icon name="chevron-right" [size]="12" slot="icon" />
          </app-button>
        </div>

        <div class="overflow-auto rounded-xl border border-border bg-gray-100 p-2">
          <div #stage class="relative mx-auto w-full max-w-[640px] select-none" data-testid="base-pdf-stage">
            <img [src]="current().image" [alt]="'Página ' + page() + ' del PDF base'" class="block w-full" draggable="false" />
            @for (box of boxes(); track box.id) {
              <div
                class="absolute cursor-move overflow-hidden rounded border-2 text-[10px] leading-tight touch-none"
                [class]="box.selected ? 'border-primary bg-primary/20 z-10' : box.kind === 'slot' ? 'border-amber-500 bg-amber-200/40' : 'border-sky-500 bg-sky-200/40'"
                [style.left.%]="box.left"
                [style.top.%]="box.top"
                [style.width.%]="box.width"
                [style.height.%]="box.height"
                tabindex="0"
                role="button"
                [attr.aria-label]="box.label"
                [attr.data-testid]="box.kind === 'slot' ? 'slot-box' : 'field-box'"
                (pointerdown)="down($event, box.sel, 'move')"
                (pointermove)="move($event)"
                (pointerup)="up($event)"
                (pointercancel)="up($event)"
                (keydown)="key($event, box.sel)"
              >
                <span class="pointer-events-none block truncate px-1 font-medium text-text-primary">{{ box.label }}</span>
                <span
                  class="absolute bottom-0 right-0 h-3 w-3 cursor-nwse-resize bg-primary"
                  aria-hidden="true"
                  (pointerdown)="down($event, box.sel, 'resize')"
                  (pointermove)="move($event)"
                  (pointerup)="up($event)"
                  (pointercancel)="up($event)"
                ></span>
              </div>
            }
          </div>
        </div>

        @if (selected(); as item) {
          <div class="flex flex-col gap-3 rounded-xl border border-border p-3" data-testid="box-properties">
            <div class="flex items-center justify-between gap-2">
              <span class="text-xs font-semibold text-text-primary">
                {{ item.sel.kind === 'slot' ? 'Casilla de firma' : 'Campo' }} seleccionado
              </span>
              <app-button variant="outline-danger" size="xsm" ariaLabel="Quitar" (clicked)="removeSelected()">
                <app-icon name="trash-2" [size]="12" slot="icon" />
              </app-button>
            </div>
            @if (item.sel.kind === 'field') {
              <app-input
                label="Valor (con variables)"
                [placeholder]="valuePlaceholder"
                [ngModel]="item.field!.value"
                (ngModelChange)="patchField({ value: $event })"
              />
              <div class="grid gap-3 sm:grid-cols-2">
                <app-input label="Tamaño de letra" type="number" [ngModel]="item.field!.font_size ?? 11" (ngModelChange)="patchField({ font_size: num($event, 11) })" />
                <app-selector label="Alineación" [options]="aligns" [value]="item.field!.align ?? 'left'" (valueChange)="setAlign($event)" />
              </div>
            } @else {
              <app-input label="Quién firma (rol)" [ngModel]="item.slot!.role_label" (ngModelChange)="patchSlot({ role_label: $event })" />
            }
            <div class="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <app-input label="Página" type="number" [ngModel]="item.box.page" (ngModelChange)="patchBox({ page: num($event, 1) })" />
              <app-input label="X" type="number" [ngModel]="round(item.box.x)" (ngModelChange)="patchBox({ x: num($event, 0) })" />
              <app-input label="Y" type="number" [ngModel]="round(item.box.y)" (ngModelChange)="patchBox({ y: num($event, 0) })" />
              <app-input label="Ancho" type="number" [ngModel]="round(item.box.width)" (ngModelChange)="patchBox({ width: num($event, min) })" />
              <app-input label="Alto" type="number" [ngModel]="round(item.box.height)" (ngModelChange)="patchBox({ height: num($event, min) })" />
            </div>
            <p class="text-xs text-text-secondary">Medidas en puntos PDF desde la esquina superior izquierda de la página.</p>
          </div>
        } @else {
          <p class="text-xs text-text-secondary">Haz clic en un recuadro para editarlo; arrástralo para moverlo o usa la esquina para cambiar su tamaño.</p>
        }
      }
    </div>
  `,
})
export class TemplateBasePdfEditorComponent {
  readonly body = input.required<BasePdfBody>();
  readonly pages = input<BasePdfPage[]>([]);
  readonly uploading = input(false);
  readonly bodyChange = output<BasePdfBody>();
  readonly fileSelected = output<File>();

  private readonly stage = viewChild<ElementRef<HTMLElement>>('stage');

  readonly aligns = ALIGNS;
  readonly min = MIN_SIZE;
  readonly valuePlaceholder = '{{ fields.nit }}';
  readonly page = signal(1);
  readonly selection = signal<Selection | null>(null);
  private drag: Drag | null = null;

  readonly current = computed(() => this.pages()[Math.min(this.page(), this.pages().length) - 1] ?? this.pages()[0]);

  /** Fields and slots of the visible page as percentage boxes over the page image. */
  readonly boxes = computed(() => {
    const page = this.current();
    if (!page) return [];
    const sel = this.selection();
    const make = (kind: Kind, index: number, box: BasePdfBox, label: string) => ({
      id: `${kind}-${index}`,
      kind,
      sel: { kind, index } as Selection,
      label,
      selected: sel?.kind === kind && sel.index === index,
      left: (box.x / page.width_pt) * 100,
      top: (box.y / page.height_pt) * 100,
      width: (box.width / page.width_pt) * 100,
      height: (box.height / page.height_pt) * 100,
      visible: box.page === this.page(),
    });
    return [
      ...this.body().fields.map((f, i) => make('field', i, f, f.value || 'Campo vacío')),
      ...this.body().signature_slots.map((s, i) => make('slot', i, s, `Firma: ${s.role_label}`)),
    ].filter((b) => b.visible);
  });

  readonly selected = computed(() => {
    const sel = this.selection();
    if (!sel) return null;
    const field = sel.kind === 'field' ? this.body().fields[sel.index] : undefined;
    const slot = sel.kind === 'slot' ? this.body().signature_slots[sel.index] : undefined;
    const box = field ?? slot;
    return box ? { sel, field, slot, box } : null;
  });

  num(value: unknown, fallback: number): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  round(value: number): number {
    return Math.round(value);
  }

  onFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) this.fileSelected.emit(file);
  }

  // ---- Adding and removing ---------------------------------------------------

  addField(): void {
    const page = this.current();
    const field: BasePdfField = {
      page: this.page(),
      x: Math.round(page.width_pt * 0.1),
      y: Math.round(page.height_pt * 0.1),
      width: 180,
      height: 16,
      value: '{{ fields.dato }}',
    };
    const fields = [...this.body().fields, field];
    this.emit({ ...this.body(), fields });
    this.selection.set({ kind: 'field', index: fields.length - 1 });
  }

  addSlot(): void {
    const page = this.current();
    const taken = new Set(this.body().signature_slots.map((s) => s.key));
    let key = 'firma';
    for (let n = 2; taken.has(key); n++) key = `firma_${n}`;
    const slot: BasePdfSlot = {
      key,
      role_label: 'Firmante',
      page: this.page(),
      x: Math.round(page.width_pt * 0.1),
      y: Math.round(page.height_pt * 0.8),
      width: 180,
      height: 60,
    };
    const signature_slots = [...this.body().signature_slots, slot];
    this.emit({ ...this.body(), signature_slots });
    this.selection.set({ kind: 'slot', index: signature_slots.length - 1 });
  }

  removeSelected(): void {
    const sel = this.selection();
    if (!sel) return;
    if (sel.kind === 'field') {
      this.emit({ ...this.body(), fields: this.body().fields.filter((_, i) => i !== sel.index) });
    } else {
      this.emit({ ...this.body(), signature_slots: this.body().signature_slots.filter((_, i) => i !== sel.index) });
    }
    this.selection.set(null);
  }

  // ---- Editing the selected box ----------------------------------------------------

  patchField(change: Partial<BasePdfField>): void {
    const sel = this.selection();
    if (sel?.kind !== 'field') return;
    this.emit({
      ...this.body(),
      fields: this.body().fields.map((f, i) => (i === sel.index ? { ...f, ...change } : f)),
    });
  }

  setAlign(value: string | number | null): void {
    if (value === 'left' || value === 'center' || value === 'right') this.patchField({ align: value });
  }

  patchSlot(change: Partial<BasePdfSlot>): void {
    const sel = this.selection();
    if (sel?.kind !== 'slot') return;
    this.emit({
      ...this.body(),
      signature_slots: this.body().signature_slots.map((s, i) => (i === sel.index ? { ...s, ...change } : s)),
    });
  }

  patchBox(change: Partial<BasePdfBox>): void {
    const sel = this.selection();
    if (!sel) return;
    if (sel.kind === 'field') this.patchField(change);
    else this.patchSlot(change);
    if (change.page !== undefined && change.page >= 1 && change.page <= this.pages().length) {
      this.page.set(change.page);
    }
  }

  // ---- Dragging (pointer events; the box captures the pointer) ---------------

  down(event: PointerEvent, sel: Selection, mode: 'move' | 'resize'): void {
    event.preventDefault();
    event.stopPropagation();
    const stage = this.stage()?.nativeElement;
    const page = this.current();
    const item = this.boxOf(sel);
    if (!stage || !page || !item) return;
    this.selection.set(sel);
    this.drag = {
      sel,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      origin: { page: item.page, x: item.x, y: item.y, width: item.width, height: item.height },
      scale: page.width_pt / stage.getBoundingClientRect().width,
    };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  move(event: PointerEvent): void {
    const drag = this.drag;
    const page = this.current();
    if (!drag || !page) return;
    const dx = (event.clientX - drag.startX) * drag.scale;
    const dy = (event.clientY - drag.startY) * drag.scale;
    const o = drag.origin;
    if (drag.mode === 'move') {
      this.setBox(drag.sel, {
        x: clamp(o.x + dx, 0, page.width_pt - o.width),
        y: clamp(o.y + dy, 0, page.height_pt - o.height),
      });
    } else {
      this.setBox(drag.sel, {
        width: clamp(o.width + dx, MIN_SIZE, page.width_pt - o.x),
        height: clamp(o.height + dy, MIN_SIZE, page.height_pt - o.y),
      });
    }
  }

  up(event: PointerEvent): void {
    if (!this.drag) return;
    this.drag = null;
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture?.(event.pointerId)) target.releasePointerCapture(event.pointerId);
  }

  /** Arrow keys nudge the box by 1 point (10 with Shift). */
  key(event: KeyboardEvent, sel: Selection): void {
    const step = event.shiftKey ? 10 : 1;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const d = delta[event.key];
    const item = this.boxOf(sel);
    const page = this.current();
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      this.selection.set(sel);
      this.removeSelected();
      return;
    }
    if (!d || !item || !page) {
      if (event.key === 'Enter' || event.key === ' ') this.selection.set(sel);
      return;
    }
    event.preventDefault();
    this.selection.set(sel);
    this.setBox(sel, {
      x: clamp(item.x + d[0], 0, page.width_pt - item.width),
      y: clamp(item.y + d[1], 0, page.height_pt - item.height),
    });
  }

  private boxOf(sel: Selection): BasePdfBox | undefined {
    return sel.kind === 'field' ? this.body().fields[sel.index] : this.body().signature_slots[sel.index];
  }

  private setBox(sel: Selection, change: Partial<BasePdfBox>): void {
    const rounded = Object.fromEntries(Object.entries(change).map(([k, v]) => [k, Math.round(v as number)]));
    if (sel.kind === 'field') {
      this.emit({
        ...this.body(),
        fields: this.body().fields.map((f, i) => (i === sel.index ? { ...f, ...rounded } : f)),
      });
    } else {
      this.emit({
        ...this.body(),
        signature_slots: this.body().signature_slots.map((s, i) => (i === sel.index ? { ...s, ...rounded } : s)),
      });
    }
  }

  private emit(next: BasePdfBody): void {
    this.bodyChange.emit(next);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
