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
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { ToastService } from '../../../../../../shared/components';

let idSeq = 0;

const BLOCK_ICONS: Record<CrmBlockType, string> = {
  hero: 'layout',
  features: 'check-circle',
  products_grid: 'shopping-bag',
  about: 'info',
  contact: 'mail',
  footer_cta: 'megaphone',
};

@Component({
  selector: 'app-crm-editor',
  imports: [CommonModule, IconComponent, ButtonComponent, BlockRendererComponent],
  templateUrl: './crm-editor.component.html',
  styleUrl: './crm-editor.component.scss',
})
export class CrmEditorComponent {
  private readonly toast = inject(ToastService);

  readonly previewMode = signal<'desktop' | 'mobile'>('desktop');

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

  iconFor(type: CrmBlockType): string {
    return BLOCK_ICONS[type] ?? 'box';
  }

  typesList(): CrmBlockType[] {
    return [...CRM_BLOCK_TYPES];
  }

  setPreviewMode(mode: 'desktop' | 'mobile'): void {
    this.previewMode.set(mode);
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

  getFieldValue(block: CrmBlock, fieldKey: string): string {
    const val = (block.props as any)?.[fieldKey];
    if (val == null) return '';
    if (Array.isArray(val)) {
      return val
        .map((item) => {
          if (typeof item === 'string') return item;
          if (item && typeof item === 'object') {
            const title = item.title || item.name || '';
            const desc = item.description || item.desc || '';
            return desc ? `${title} | ${desc}` : title;
          }
          return '';
        })
        .filter(Boolean)
        .join('\n');
    }
    if (typeof val === 'object') {
      return JSON.stringify(val);
    }
    return String(val);
  }

  ctaClicked(): void {
    this.toast.info('El botón funcionará en tu landing publicada');
  }

  openPublicLanding(): void {
    window.open('/', '_blank', 'noopener,noreferrer');
  }
}
