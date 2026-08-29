import {
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  CRM_BLOCK_FIELDS,
  CRM_BLOCK_LABELS,
  CRM_BLOCK_TYPES,
  CrmBlock,
  CrmBlockType,
  CrmLandingDocument,
  emptyCrmLandingDocument,
} from '../../../../../../public/dynamic-landing/blocks/landing-blocks.types';
import { BlockRendererComponent } from '../../../../../../public/dynamic-landing/blocks/block-renderer/block-renderer.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ToastService } from '../../../../../../shared/components';

let idSeq = 0;

@Component({
  selector: 'app-crm-editor',
  imports: [CommonModule, IconComponent, BlockRendererComponent],
  templateUrl: './crm-editor.component.html',
  styleUrl: './crm-editor.component.scss',
})
export class CrmEditorComponent {
  private readonly toast = inject(ToastService);

  /** Documento vigente (draft del backend). Se copia al entrar para edición local. */
  readonly document = input.required<CrmLandingDocument | null>();

  readonly documentChange = output<CrmLandingDocument>();

  readonly blocks = signal<CrmBlock[]>([]);
  readonly selectedIndex = signal<number | null>(null);
  readonly adding = signal(false);

  readonly selectedBlock = computed<CrmBlock | null>(() => {
    const index = this.selectedIndex();
    const blocks = this.blocks();
    return index != null && index >= 0 && index < blocks.length
      ? blocks[index]
      : null;
  });

  readonly fields = computed(() => {
    const block = this.selectedBlock();
    return block ? CRM_BLOCK_FIELDS[block.type] : [];
  });

  constructor() {
    // Signal inputs no disparan ngOnChanges: el efecto re-sincroniza la
    // copia local cada vez que el padre entrega un documento nuevo
    // (tras guardar/publicar/recargar).
    effect(() => {
      this.resetFromDocument(this.document());
    });
  }

  private resetFromDocument(document: CrmLandingDocument | null): void {
    const source = document ?? emptyCrmLandingDocument();
    const newBlocks = source.blocks.map((b) => ({ ...b, props: { ...b.props } }));
    this.blocks.set(newBlocks);
    const currentIndex = this.selectedIndex();
    if (currentIndex != null && currentIndex >= newBlocks.length) {
      this.selectedIndex.set(null);
    }
  }

  private emitDocument(): void {
    this.documentChange.emit({
      schema_version: 1,
      theme: {},
      blocks: this.blocks(),
    });
  }

  select(index: number): void {
    this.selectedIndex.set(index);
  }

  move(index: number, direction: -1 | 1): void {
    const target = index + direction;
    const blocks = [...this.blocks()];
    if (target < 0 || target >= blocks.length) return;
    [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
    this.blocks.set(blocks);
    this.selectedIndex.set(target);
    this.emitDocument();
  }

  remove(index: number): void {
    const blocks = this.blocks().filter((_, i) => i !== index);
    this.blocks.set(blocks);
    if (this.selectedIndex() === index) this.selectedIndex.set(null);
    this.emitDocument();
  }

  toggleAdding(): void {
    this.adding.update((v) => !v);
  }

  addBlock(type: CrmBlockType): void {
    const block: CrmBlock = {
      id: `${type}_${Date.now()}_${idSeq++}`,
      type,
      props: Object.fromEntries(
        CRM_BLOCK_FIELDS[type].map((f) => [f.key, '']),
      ),
    };
    this.blocks.update((b) => [...b, block]);
    this.selectedIndex.set(this.blocks().length - 1);
    this.adding.set(false);
    this.emitDocument();
  }

  labelFor(type: CrmBlockType): string {
    return CRM_BLOCK_LABELS[type];
  }

  typesList(): CrmBlockType[] {
    return [...CRM_BLOCK_TYPES];
  }

  onPropChange(key: string, value: string): void {
    const index = this.selectedIndex();
    if (index == null) return;
    this.blocks.update((blocks) =>
      blocks.map((b, i) =>
        i === index ? { ...b, props: { ...b.props, [key]: value } } : b,
      ),
    );
    this.emitDocument();
  }

  ctaClicked(): void {
    this.toast.info('El botón funcionará en tu landing publicada');
  }
}
