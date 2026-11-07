import { Component, computed, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  ButtonComponent,
  IconComponent,
  InputComponent,
  SelectorComponent,
  TextareaComponent,
  ToggleComponent,
} from '../../../../../../shared/components/index';
import {
  BlockAlign,
  BlocksBody,
  PageSizeName,
  SignatureSlot,
  TemplateBlock,
} from '../../interfaces/document-template.interfaces';

type BlockType = TemplateBlock['type'];

const BLOCK_LABEL: Record<BlockType, string> = {
  heading: 'Título',
  paragraph: 'Párrafo',
  fields: 'Datos (etiqueta y valor)',
  table: 'Tabla',
  image: 'Logo de la tienda',
  spacer: 'Espacio',
  page_break: 'Salto de página',
  signature: 'Casilla de firma',
};

const ADDABLE: Array<{ type: BlockType; icon: string }> = [
  { type: 'heading', icon: 'bold' },
  { type: 'paragraph', icon: 'align-left' },
  { type: 'fields', icon: 'list' },
  { type: 'table', icon: 'table' },
  { type: 'image', icon: 'image' },
  { type: 'spacer', icon: 'arrow-up-down' },
  { type: 'page_break', icon: 'file-minus' },
  { type: 'signature', icon: 'pen-line' },
];

const ALIGN_OPTIONS = [
  { value: 'left', label: 'Izquierda' },
  { value: 'center', label: 'Centrado' },
  { value: 'right', label: 'Derecha' },
  { value: 'justify', label: 'Justificado' },
];
const LEVEL_OPTIONS = [
  { value: 1, label: 'Grande' },
  { value: 2, label: 'Mediano' },
  { value: 3, label: 'Pequeño' },
];
const SIZE_OPTIONS = [
  { value: 'A4', label: 'A4' },
  { value: 'LETTER', label: 'Carta' },
];

/** Block editor: page, header and footer, the ordered blocks and the signature slots. */
@Component({
  selector: 'app-template-blocks-editor',
  standalone: true,
  imports: [FormsModule, ButtonComponent, IconComponent, InputComponent, SelectorComponent, TextareaComponent, ToggleComponent],
  template: `
    <div class="flex flex-col gap-4" data-testid="blocks-editor">
      <section class="grid gap-3 rounded-xl border border-border p-3 sm:grid-cols-2">
        <app-selector
          label="Tamaño de página"
          [options]="sizes"
          [value]="body().page.size"
          (valueChange)="setSize($event)"
        />
        <app-toggle
          label="Logo de la tienda en el encabezado"
          [checked]="body().header?.show_logo === true"
          (toggled)="setHeader({ show_logo: $event })"
        />
        <app-input
          label="Texto del encabezado"
          [placeholder]="headerPlaceholder"
          [ngModel]="body().header?.text ?? ''"
          (ngModelChange)="setHeader({ text: $event })"
        />
        <app-input
          label="Texto del pie de página"
          [ngModel]="body().footer?.text ?? ''"
          (ngModelChange)="setFooter({ text: $event })"
        />
        <app-toggle
          label="Numerar las páginas"
          [checked]="body().footer?.page_numbers === true"
          (toggled)="setFooter({ page_numbers: $event })"
        />
      </section>

      <section class="flex flex-col gap-2">
        <h3 class="text-sm font-semibold text-text-primary">Casillas de firma</h3>
        @for (slot of slots(); track $index; let i = $index) {
          <div class="flex items-end gap-2" data-testid="signature-slot">
            <div class="min-w-0 flex-1">
              <app-input
                label="Quién firma (rol)"
                placeholder="Empleado"
                [ngModel]="slot.role_label"
                (ngModelChange)="renameSlot(i, $event)"
              />
            </div>
            <app-button variant="outline-danger" size="sm" ariaLabel="Quitar casilla de firma" (clicked)="removeSlot(i)">
              <app-icon name="trash-2" [size]="14" slot="icon" />
            </app-button>
          </div>
        } @empty {
          <p class="text-xs text-text-secondary">Sin casillas. Agrégalas para poder usar bloques de firma.</p>
        }
        <app-button variant="outline" size="sm" [disabled]="slots().length >= 6" (clicked)="addSlot()">
          <app-icon name="plus" [size]="14" slot="icon" />
          Agregar casilla de firma
        </app-button>
      </section>

      <section class="flex flex-col gap-3">
        <h3 class="text-sm font-semibold text-text-primary">Contenido</h3>
        @for (block of body().blocks; track $index; let i = $index) {
          <div class="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3" data-testid="block" [attr.data-block-type]="block.type">
            <div class="flex items-center justify-between gap-2">
              <span class="text-xs font-semibold text-text-primary">{{ i + 1 }}. {{ blockLabel(block.type) }}</span>
              <div class="flex items-center gap-1">
                <app-button variant="outline" size="xsm" ariaLabel="Subir bloque" [disabled]="i === 0" (clicked)="move(i, -1)">
                  <app-icon name="arrow-up" [size]="12" slot="icon" />
                </app-button>
                <app-button variant="outline" size="xsm" ariaLabel="Bajar bloque" [disabled]="i === body().blocks.length - 1" (clicked)="move(i, 1)">
                  <app-icon name="arrow-down" [size]="12" slot="icon" />
                </app-button>
                <app-button variant="outline-danger" size="xsm" ariaLabel="Quitar bloque" (clicked)="remove(i)">
                  <app-icon name="trash-2" [size]="12" slot="icon" />
                </app-button>
              </div>
            </div>

            @if (block.type === 'heading') {
                <app-input label="Texto" [ngModel]="block.text" (ngModelChange)="patch(i, { text: $event })" />
                <div class="grid gap-3 sm:grid-cols-2">
                  <app-selector label="Tamaño" [options]="levels" [value]="block.level" (valueChange)="patch(i, { level: $event })" />
                  <app-selector label="Alineación" [options]="aligns" [value]="block.align ?? 'left'" (valueChange)="patch(i, { align: $event })" />
                </div>
            } @else if (block.type === 'paragraph') {
                <app-textarea label="Texto" [rows]="4" [ngModel]="block.text" (ngModelChange)="patch(i, { text: $event })" />
                <app-selector label="Alineación" [options]="aligns" [value]="block.align ?? 'left'" (valueChange)="patch(i, { align: $event })" />
            } @else if (block.type === 'fields') {
                @for (row of block.rows; track $index; let r = $index) {
                  <div class="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                    <app-input label="Etiqueta" [ngModel]="row.label" (ngModelChange)="patchRow(i, r, { label: $event })" />
                    <app-input label="Valor" [ngModel]="row.value" (ngModelChange)="patchRow(i, r, { value: $event })" />
                    <app-button variant="outline-danger" size="sm" ariaLabel="Quitar fila" [disabled]="block.rows.length <= 1" (clicked)="removeRow(i, r)">
                      <app-icon name="trash-2" [size]="14" slot="icon" />
                    </app-button>
                  </div>
                }
                <app-button variant="outline" size="sm" [disabled]="block.rows.length >= 50" (clicked)="addRow(i)">
                  <app-icon name="plus" [size]="14" slot="icon" />
                  Agregar fila
                </app-button>
            } @else if (block.type === 'table') {
                <app-input
                  label="Lista de la solicitud"
                  placeholder="fields.items"
                  helperText="Un campo de tipo lista del flujo. En las columnas usa variables row.nombre."
                  [ngModel]="block.source"
                  (ngModelChange)="patch(i, { source: $event })"
                />
                @for (col of block.columns; track $index; let c = $index) {
                  <div class="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                    <app-input label="Encabezado" [ngModel]="col.header" (ngModelChange)="patchColumn(i, c, { header: $event })" />
                    <app-input label="Valor" placeholder="row.nombre" [ngModel]="col.value" (ngModelChange)="patchColumn(i, c, { value: $event })" />
                    <app-button variant="outline-danger" size="sm" ariaLabel="Quitar columna" [disabled]="block.columns.length <= 1" (clicked)="removeColumn(i, c)">
                      <app-icon name="trash-2" [size]="14" slot="icon" />
                    </app-button>
                  </div>
                }
                <app-button variant="outline" size="sm" [disabled]="block.columns.length >= 8" (clicked)="addColumn(i)">
                  <app-icon name="plus" [size]="14" slot="icon" />
                  Agregar columna
                </app-button>
            } @else if (block.type === 'image') {
                <app-input label="Ancho (puntos)" type="number" [ngModel]="block.width ?? 120" (ngModelChange)="patch(i, { width: toNumber($event, 120) })" />
            } @else if (block.type === 'spacer') {
                <app-input label="Alto (puntos)" type="number" [ngModel]="block.height" (ngModelChange)="patch(i, { height: toNumber($event, 20) })" />
            } @else if (block.type === 'signature') {
                <app-selector
                  label="Casilla"
                  placeholder="Elige una casilla"
                  [options]="slotOptions()"
                  [value]="block.slot_key"
                  (valueChange)="patch(i, { slot_key: $event })"
                />
            }
          </div>
        }
        <div class="flex flex-wrap gap-2" data-testid="add-block">
          @for (option of addable; track option.type) {
            <app-button variant="outline" size="sm" [disabled]="body().blocks.length >= 200" (clicked)="add(option.type)">
              <app-icon [name]="option.icon" [size]="14" slot="icon" />
              {{ blockLabel(option.type) }}
            </app-button>
          }
        </div>
      </section>
    </div>
  `,
})
export class TemplateBlocksEditorComponent {
  readonly body = input.required<BlocksBody>();
  readonly bodyChange = output<BlocksBody>();

  readonly aligns = ALIGN_OPTIONS;
  readonly levels = LEVEL_OPTIONS;
  readonly sizes = SIZE_OPTIONS;
  readonly addable = ADDABLE;
  readonly headerPlaceholder = '{{ store.name }}';

  readonly slots = computed(() => this.body().signature_slots ?? []);
  readonly slotOptions = computed(() => this.slots().map((s) => ({ value: s.key, label: s.role_label || s.key })));

  blockLabel(type: BlockType): string {
    return BLOCK_LABEL[type];
  }

  toNumber(value: unknown, fallback: number): number {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }

  private emit(next: BlocksBody): void {
    this.bodyChange.emit(next);
  }

  private withBlocks(blocks: TemplateBlock[]): void {
    this.emit({ ...this.body(), blocks });
  }

  setSize(value: string | number | null): void {
    if (value === 'A4' || value === 'LETTER') {
      this.emit({ ...this.body(), page: { ...this.body().page, size: value as PageSizeName } });
    }
  }

  setHeader(change: { show_logo?: boolean; text?: string }): void {
    this.emit({ ...this.body(), header: { ...this.body().header, ...change } });
  }

  setFooter(change: { text?: string; page_numbers?: boolean }): void {
    this.emit({ ...this.body(), footer: { ...this.body().footer, ...change } });
  }

  // ---- Blocks --------------------------------------------------------------

  add(type: BlockType): void {
    const slot = this.slots()[0]?.key ?? '';
    const created: Record<BlockType, TemplateBlock> = {
      heading: { type: 'heading', text: 'Título', level: 2 },
      paragraph: { type: 'paragraph', text: 'Texto del párrafo' },
      fields: { type: 'fields', rows: [{ label: 'Nombre', value: '{{ fields.nombre }}' }] },
      table: { type: 'table', source: 'fields.items', columns: [{ header: 'Ítem', value: '{{ row.nombre }}' }] },
      image: { type: 'image', source: 'store.logo', width: 120 },
      spacer: { type: 'spacer', height: 20 },
      page_break: { type: 'page_break' },
      signature: { type: 'signature', slot_key: slot },
    };
    this.withBlocks([...this.body().blocks, created[type]]);
  }

  remove(index: number): void {
    this.withBlocks(this.body().blocks.filter((_, i) => i !== index));
  }

  move(index: number, delta: -1 | 1): void {
    const blocks = [...this.body().blocks];
    const target = index + delta;
    if (target < 0 || target >= blocks.length) return;
    [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
    this.withBlocks(blocks);
  }

  patch(index: number, change: Record<string, unknown>): void {
    this.withBlocks(this.body().blocks.map((b, i) => (i === index ? ({ ...b, ...change } as TemplateBlock) : b)));
  }

  private rowsOf(index: number) {
    const block = this.body().blocks[index];
    return block.type === 'fields' ? block.rows : [];
  }

  patchRow(index: number, row: number, change: { label?: string; value?: string }): void {
    this.patch(index, { rows: this.rowsOf(index).map((r, i) => (i === row ? { ...r, ...change } : r)) });
  }

  addRow(index: number): void {
    this.patch(index, { rows: [...this.rowsOf(index), { label: 'Dato', value: '{{ fields.dato }}' }] });
  }

  removeRow(index: number, row: number): void {
    this.patch(index, { rows: this.rowsOf(index).filter((_, i) => i !== row) });
  }

  private columnsOf(index: number) {
    const block = this.body().blocks[index];
    return block.type === 'table' ? block.columns : [];
  }

  patchColumn(index: number, column: number, change: { header?: string; value?: string }): void {
    this.patch(index, { columns: this.columnsOf(index).map((c, i) => (i === column ? { ...c, ...change } : c)) });
  }

  addColumn(index: number): void {
    this.patch(index, { columns: [...this.columnsOf(index), { header: 'Columna', value: '{{ row.valor }}' }] });
  }

  removeColumn(index: number, column: number): void {
    this.patch(index, { columns: this.columnsOf(index).filter((_, i) => i !== column) });
  }

  // ---- Signature slots ---------------------------------------------------------

  addSlot(): void {
    const taken = new Set(this.slots().map((s) => s.key));
    let key = 'firma';
    for (let n = 2; taken.has(key); n++) key = `firma_${n}`;
    const slot: SignatureSlot = { key, role_label: 'Firmante' };
    this.emit({ ...this.body(), signature_slots: [...this.slots(), slot] });
  }

  /** The label is what people see; the key stays stable once blocks point at it. */
  renameSlot(index: number, label: string): void {
    const slots = this.slots().map((s, i) => (i === index ? { ...s, role_label: label } : s));
    this.emit({ ...this.body(), signature_slots: slots });
  }

  removeSlot(index: number): void {
    const removed = this.slots()[index];
    this.emit({
      ...this.body(),
      signature_slots: this.slots().filter((_, i) => i !== index),
      // A signature block of a removed slot would no longer be valid.
      blocks: this.body().blocks.filter((b) => !(b.type === 'signature' && b.slot_key === removed.key)),
    });
  }
}
