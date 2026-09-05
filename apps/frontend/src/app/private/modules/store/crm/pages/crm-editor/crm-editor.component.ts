import {
  Component,
  computed,
  effect,
  HostListener,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  CRM_BLOCK_CATALOG,
  CRM_BLOCK_FIELDS,
  CRM_BLOCK_LABELS,
  CRM_BLOCK_TYPES,
  CrmBlock,
  CrmBlockMeta,
  CrmBlockType,
  CrmLandingDocument,
  CrmLandingTheme,
  emptyCrmLandingDocument,
} from '../../../../../../public/dynamic-landing/blocks/landing-blocks.types';
import { BlockRendererComponent } from '../../../../../../public/dynamic-landing/blocks/block-renderer/block-renderer.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ToastService } from '../../../../../../shared/components';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';

let idSeq = 0;

export interface ColorPreset {
  name: string;
  primary: string;
  secondary: string;
  badge: string;
}

export const COLOR_PRESETS: ColorPreset[] = [
  { name: 'Azul Tech / Pro', primary: '#1E40AF', secondary: '#0EA5E9', badge: 'Tecnología & Retail' },
  { name: 'Esmeralda Vital', primary: '#059669', secondary: '#10B981', badge: 'Salud, Bienestar & Hogar' },
  { name: 'Púrpura Moderno', primary: '#7C3AED', secondary: '#C084FC', badge: 'Moda, Belleza & Joyería' },
  { name: 'Naranja Dinámico', primary: '#EA580C', secondary: '#FB923C', badge: 'Restaurante & Comida' },
  { name: 'Rojo Vital / Pasión', primary: '#DC2626', secondary: '#F87171', badge: 'Deportes & Ofertas' },
  { name: 'Dark Luxury', primary: '#0F172A', secondary: '#334155', badge: 'Alta Gama & Lujo' },
];

const BLOCK_ICONS: Record<CrmBlockType, string> = {
  hero: 'image',
  features: 'shield-check',
  products_grid: 'shopping-bag',
  store_gallery: 'image',
  testimonials: 'star',
  faq: 'help-circle',
  location_hours: 'map-pin',
  promo_banner: 'tag',
  about: 'building',
  contact: 'mail',
  footer_cta: 'zap',
};

@Component({
  selector: 'app-crm-editor',
  standalone: true,
  imports: [CommonModule, IconComponent, BlockRendererComponent],
  templateUrl: './crm-editor.component.html',
  styleUrl: './crm-editor.component.scss',
})
export class CrmEditorComponent {
  private readonly toast = inject(ToastService);
  private readonly authFacade = inject(AuthFacade);

  readonly storeDomainHostname = this.authFacade.userDomainHostname;
  readonly previewMode = signal<'desktop' | 'mobile'>('mobile');
  readonly activeTab = signal<'sections' | 'theme' | 'ai'>('sections');

  /** Documento vigente (draft del backend). Se copia al entrar para edición local. */
  readonly document = input.required<CrmLandingDocument | null>();
  readonly isBusy = input<boolean>(false);
  readonly hasPendingChanges = input<boolean>(false);

  readonly documentChange = output<CrmLandingDocument>();
  readonly saveDraft = output<void>();
  readonly publish = output<void>();
  readonly discard = output<void>();

  readonly blocks = signal<CrmBlock[]>([]);
  readonly theme = signal<CrmLandingTheme>({
    primary_color: '#1E40AF',
    secondary_color: '#0F172A',
    enable_whatsapp_float: true,
    border_radius: 'rounded-2xl',
  });

  readonly selectedIndex = signal<number | null>(null);
  readonly reorderingIndex = signal<number | null>(null);
  readonly activeSubModal = signal<'none' | 'theme' | 'ai'>('none');
  readonly catalogModalOpen = signal(false);
  readonly laptopModalOpen = signal(false);
  readonly catalogCategory = signal<string>('all');

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

  readonly primaryColor = computed(() => this.theme().primary_color || '#1E40AF');
  readonly secondaryColor = computed(() => this.theme().secondary_color || '#0F172A');
  readonly colorPresets = COLOR_PRESETS;
  readonly blockCatalog = CRM_BLOCK_CATALOG;

  readonly filteredCatalog = computed(() => {
    const cat = this.catalogCategory();
    if (cat === 'all') return this.blockCatalog;
    return this.blockCatalog.filter((item) => item.category === cat);
  });

  constructor() {
    effect(() => {
      this.resetFromDocument(this.document());
    });
  }

  private resetFromDocument(document: CrmLandingDocument | null): void {
    const source = document ?? emptyCrmLandingDocument();
    const newBlocks = (source.blocks || []).map((b) => ({ ...b, props: { ...b.props } }));
    this.blocks.set(newBlocks);
    if (source.theme) {
      this.theme.set({
        primary_color: source.theme.primary_color || '#1E40AF',
        secondary_color: source.theme.secondary_color || '#0F172A',
        whatsapp_number: source.theme.whatsapp_number || '',
        whatsapp_message: source.theme.whatsapp_message || '',
        border_radius: source.theme.border_radius || 'rounded-2xl',
        enable_whatsapp_float: source.theme.enable_whatsapp_float ?? true,
      });
    }
    const currentIndex = this.selectedIndex();
    if (currentIndex != null && currentIndex >= newBlocks.length) {
      this.selectedIndex.set(null);
    }
  }

  private emitDocument(): void {
    this.documentChange.emit({
      schema_version: 1,
      theme: this.theme(),
      blocks: this.blocks(),
    });
  }

  select(index: number): void {
    this.selectedIndex.set(index);
    this.activeTab.set('sections');
  }

  deselect(): void {
    this.selectedIndex.set(null);
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
    this.toast.success('Sección eliminada del borrador');
  }

  openCatalog(): void {
    this.catalogModalOpen.set(true);
  }

  closeCatalog(): void {
    this.catalogModalOpen.set(false);
  }

  addBlock(type: CrmBlockType): void {
    const block: CrmBlock = {
      id: `${type}_${Date.now()}_${idSeq++}`,
      type,
      props: Object.fromEntries(
        (CRM_BLOCK_FIELDS[type] || []).map((f) => [f.key, '']),
      ),
    };
    this.blocks.update((b) => [...b, block]);
    this.selectedIndex.set(this.blocks().length - 1);
    this.catalogModalOpen.set(false);
    this.emitDocument();
    this.toast.success(`Sección "${this.labelFor(type)}" agregada`);
  }

  labelFor(type: CrmBlockType): string {
    return CRM_BLOCK_LABELS[type] || type;
  }

  subtitleFor(type: CrmBlockType): string {
    const map: Record<CrmBlockType, string> = {
      hero: 'Hero',
      features: 'features, beneficios y valores',
      products_grid: 'products.gnd',
      store_gallery: 'store_gallery',
      testimonials: 'testimonios',
      faq: 'faq, preguntas frecuentes',
      location_hours: 'ubicación y horarios',
      promo_banner: 'banner promocional',
      about: 'sobre nosotros',
      contact: 'formulario de contacto',
      footer_cta: 'llamado a la acción',
    };
    return map[type] || type;
  }

  toggleReorder(index: number): void {
    this.reorderingIndex.update((current) => (current === index ? null : index));
  }

  openThemeModal(): void {
    this.activeSubModal.set('theme');
  }

  openAiModal(): void {
    this.activeSubModal.set('ai');
  }

  closeSubModal(): void {
    this.activeSubModal.set('none');
  }

  iconFor(type: CrmBlockType): string {
    return BLOCK_ICONS[type] ?? 'box';
  }

  setPreviewMode(mode: 'desktop' | 'mobile'): void {
    if (mode === 'desktop') {
      this.openLaptopModal();
    } else {
      this.previewMode.set('mobile');
    }
  }

  openLaptopModal(): void {
    this.laptopModalOpen.set(true);
    this.previewMode.set('desktop');
  }

  closeLaptopModal(): void {
    this.laptopModalOpen.set(false);
    this.previewMode.set('mobile');
  }

  @HostListener('window:keydown.escape')
  onEscapePress(): void {
    if (this.laptopModalOpen()) {
      this.closeLaptopModal();
    }
  }

  setActiveTab(tab: 'sections' | 'theme' | 'ai'): void {
    this.activeTab.set(tab);
  }

  applyPreset(preset: ColorPreset): void {
    this.theme.update((t) => ({
      ...t,
      primary_color: preset.primary,
      secondary_color: preset.secondary,
    }));
    this.emitDocument();
    this.toast.success(`Paleta "${preset.name}" aplicada`);
  }

  onThemeChange(key: keyof CrmLandingTheme, value: any): void {
    this.theme.update((t) => ({ ...t, [key]: value }));
    this.emitDocument();
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
            const title = item.title || item.name || item.question || '';
            const desc = item.description || item.desc || item.answer || item.comment || '';
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
    this.toast.info('El botón de acción funcionará directamente en tu landing pública');
  }

  openPublicLanding(): void {
    const hostname = this.storeDomainHostname();
    const targetUrl = hostname
      ? `https://${hostname}`
      : `${window.location.protocol}//${window.location.host}/landing`;
    window.open(targetUrl, '_blank', 'noopener,noreferrer');
  }
}

