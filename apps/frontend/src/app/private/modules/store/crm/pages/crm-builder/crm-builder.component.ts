import {
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  CRM_BLOCK_CATALOG,
  CRM_BLOCK_FIELDS,
  CRM_BLOCK_LABELS,
  CRM_BLOCK_TYPES,
  CrmBlock,
  CrmBlockFieldConfig,
  CrmBlockType,
  CrmLandingDocument,
  CrmLandingTheme,
  emptyCrmLandingDocument,
} from '../../../../../../public/dynamic-landing/blocks/landing-blocks.types';
import { BlockRendererComponent } from '../../../../../../public/dynamic-landing/blocks/block-renderer/block-renderer.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { ToastService } from '../../../../../../shared/components';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { CrmService } from '../../services/crm.service';

export interface StylePreset {
  id: string;
  name: string;
  category: string;
  description: string;
  primary_color: string;
  secondary_color: string;
  border_radius: 'rounded-lg' | 'rounded-2xl' | 'rounded-full';
  font_style: string;
  accent_badge: string;
}

export interface VendixModuleIntegration {
  id: 'products' | 'whatsapp' | 'locations';
  name: string;
  icon: string;
  description: string;
  enabled: boolean;
  statusBadge: string;
}

type ActiveDrawer = 'none' | 'ai' | 'structure' | 'styles' | 'modules' | 'edit-block';

let blockIdCounter = 0;

@Component({
  selector: 'app-crm-builder',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    IconComponent,
    ButtonComponent,
    BlockRendererComponent,
  ],
  templateUrl: './crm-builder.component.html',
  styleUrl: './crm-builder.component.scss',
})
export class CrmBuilderComponent implements OnInit {
  private readonly crmService = inject(CrmService);
  private readonly toast = inject(ToastService);
  private readonly authFacade = inject(AuthFacade);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly storeDomainHostname = this.authFacade.userDomainHostname;

  // Estados de interfaz y visualización
  readonly isLoading = signal<boolean>(true);
  readonly isSaving = signal<boolean>(false);
  readonly hasChanges = signal<boolean>(false);
  readonly previewMode = signal<'desktop' | 'mobile'>('desktop');
  readonly activeDrawer = signal<ActiveDrawer>('none');

  // Documento y estructura reactiva
  readonly serverDocument = signal<CrmLandingDocument | null>(null);
  readonly blocks = signal<CrmBlock[]>([]);
  readonly theme = signal<CrmLandingTheme>({
    primary_color: '#1E40AF',
    secondary_color: '#0F172A',
    border_radius: 'rounded-2xl',
    enable_whatsapp_float: true,
    whatsapp_number: '',
    whatsapp_message: 'Hola, tengo una consulta sobre sus productos.',
  });

  // Selección y edición de bloques
  readonly selectedIndex = signal<number | null>(null);
  readonly catalogModalOpen = signal<boolean>(false);
  readonly catalogCategory = signal<string>('all');

  // Asistente IA
  readonly naturalPrompt = signal<string>('');
  readonly isProcessingAi = signal<boolean>(false);
  readonly copiedPrompt = signal<boolean>(false);

  readonly quickPrompts: string[] = [
    'Destacar oferta especial del 20% en el encabezado',
    'Añadir bloque de preguntas frecuentes y garantías',
    'Cambiar paleta a un estilo oscuro y sofisticado',
    'Enfocar la propuesta de valor en atención por WhatsApp',
    'Actualizar testimonios con calificaciones de 5 estrellas',
  ];

  // Presets de Estilo
  readonly stylePresets: StylePreset[] = [
    {
      id: 'tech-pro',
      name: 'Tech & Innovación Pro',
      category: 'Tecnología & Retail',
      description: 'Azul vibrante con acentos oscuros. Ideal para productos tecnológicos y servicios.',
      primary_color: '#1E40AF',
      secondary_color: '#0EA5E9',
      border_radius: 'rounded-2xl',
      font_style: 'Moderna / Sans-Serif',
      accent_badge: 'Recomendado Tech',
    },
    {
      id: 'emerald-vital',
      name: 'Esmeralda Vital & Orgánico',
      category: 'Salud, Bienestar & Hogar',
      description: 'Tonos verdes naturales con sensación de frescura, confianza y sostenibilidad.',
      primary_color: '#059669',
      secondary_color: '#10B981',
      border_radius: 'rounded-2xl',
      font_style: 'Cálida / Suave',
      accent_badge: 'Ecológico & Salud',
    },
    {
      id: 'luxury-dark',
      name: 'Obsidiana & Ámbar Elegance',
      category: 'Lujo, Joyería & Gourmet',
      description: 'Fondo de alta sofisticación con acentos dorados y bordes definidos.',
      primary_color: '#D97706',
      secondary_color: '#1E293B',
      border_radius: 'rounded-lg',
      font_style: 'Elegante / Editorial',
      accent_badge: 'Premium',
    },
    {
      id: 'sunset-energy',
      name: 'Energía & Retail Urbano',
      category: 'Moda, Calzado & Deporte',
      description: 'Paleta dinámica de alta conversión para ofertas flash y ventas de alto impacto.',
      primary_color: '#DC2626',
      secondary_color: '#F97316',
      border_radius: 'rounded-2xl',
      font_style: 'Audaz / Bold',
      accent_badge: 'Alta Conversión',
    },
    {
      id: 'violet-creatives',
      name: 'Violeta Creativo & SaaS',
      category: 'Consultoría & Educación',
      description: 'Gradientes modernos y paleta visual inspirada en marcas digitales de vanguardia.',
      primary_color: '#7C3AED',
      secondary_color: '#A855F7',
      border_radius: 'rounded-2xl',
      font_style: 'Digital / Modern',
      accent_badge: 'Creativo',
    },
  ];

  // Integraciones con Módulos de Vendix
  readonly vendixModules = signal<VendixModuleIntegration[]>([
    {
      id: 'products',
      name: 'Catálogo de Productos & Inventario',
      icon: 'shopping-bag',
      description: 'Sincroniza automáticamente los productos con stock activo y precios reales desde tu catálogo de Vendix.',
      enabled: true,
      statusBadge: 'Sincronizado en tiempo real',
    },
    {
      id: 'whatsapp',
      name: 'Canal de WhatsApp & Mensajería',
      icon: 'message-circle',
      description: 'Habilita el botón flotante directo en la landing para que tus prospectos te contacten en un clic.',
      enabled: true,
      statusBadge: 'Botón Flotante Activo',
    },
    {
      id: 'locations',
      name: 'Sedes & Geolocalización',
      icon: 'map-pin',
      description: 'Muestra a tus clientes mapa con la dirección de tu local o sedes físicas.',
      enabled: true,
      statusBadge: 'Mapa Integrado',
    },
  ]);

  readonly selectedBlock = computed<CrmBlock | null>(() => {
    const idx = this.selectedIndex();
    const list = this.blocks();
    return idx != null && idx >= 0 && idx < list.length ? list[idx] : null;
  });

  readonly selectedBlockFields = computed<CrmBlockFieldConfig[]>(() => {
    const block = this.selectedBlock();
    return block ? CRM_BLOCK_FIELDS[block.type] || [] : [];
  });

  readonly contextualQuickPrompts = computed<string[]>(() => {
    const block = this.selectedBlock();
    if (!block) {
      return this.quickPrompts;
    }
    switch (block.type) {
      case 'hero':
        return [
          'Hacer el título más persuasivo con oferta de bienvenida',
          'Enfocar el subtítulo en confianza y calidad garantizada',
          'Cambiar el botón de llamado a "Pedir por WhatsApp ahora"',
        ];
      case 'features':
        return [
          'Destacar 3 garantías: calidad, soporte 24/7 y envío seguro',
          'Enfocar los beneficios en ahorro y satisfacción del cliente',
          'Redactar títulos directos con descripciones breves',
        ];
      case 'about':
        return [
          'Contar una historia cercana de pasión y origen del negocio',
          'Enfocar en la experiencia y trayectoria de la empresa',
          'Añadir compromiso de atención personalizada',
        ];
      case 'contact':
        return [
          'Invitar a cotizar sin compromiso en minutos',
          'Añadir mensaje de atención inmediata por asesores',
        ];
      case 'products_grid':
        return [
          'Escribir un título magnético para productos más vendidos',
          'Invitar a descubrir las últimas novedades de la temporada',
        ];
      case 'testimonials':
        return [
          'Redactar 3 reseñas realistas de clientes satisfechos con 5 estrellas',
          'Destacar puntualidad y calidad del servicio recibido',
        ];
      case 'faq':
        return [
          'Añadir preguntas sobre formas de pago, envíos y devoluciones',
          'Responder con claridad sobre cobertura y tiempos de entrega',
        ];
      default:
        return [
          `Mejorar los textos y estilo de la sección ${this.labelFor(block.type)}`,
          'Hacer el contenido más profesional y atractivo',
        ];
    }
  });

  readonly blockCatalog = CRM_BLOCK_CATALOG;

  readonly filteredCatalog = computed(() => {
    const cat = this.catalogCategory();
    if (cat === 'all') return this.blockCatalog;
    return this.blockCatalog.filter((item) => item.category === cat);
  });

  ngOnInit(): void {
    this.loadLandingData();
  }

  loadLandingData(): void {
    this.isLoading.set(true);
    this.crmService
      .getLanding()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const raw = res.data?.content_json;
          const doc = (raw && typeof raw === 'object'
            ? raw
            : emptyCrmLandingDocument()) as CrmLandingDocument;
          this.serverDocument.set(doc);
          this.resetFromDocument(doc);
          this.isLoading.set(false);
          this.hasChanges.set(false);
        },
        error: () => {
          this.toast.error('No se pudo cargar la configuración de la landing');
          this.isLoading.set(false);
        },
      });
  }

  private resetFromDocument(doc: CrmLandingDocument): void {
    const newBlocks = (doc.blocks || []).map((b) => ({
      ...b,
      props: { ...b.props },
    }));
    this.blocks.set(newBlocks);

    if (doc.theme) {
      this.theme.set({
        primary_color: doc.theme.primary_color || '#1E40AF',
        secondary_color: doc.theme.secondary_color || '#0F172A',
        border_radius: doc.theme.border_radius || 'rounded-2xl',
        enable_whatsapp_float: doc.theme.enable_whatsapp_float ?? true,
        whatsapp_number: doc.theme.whatsapp_number || '',
        whatsapp_message: doc.theme.whatsapp_message || '',
      });
    }

    this.vendixModules.update((mods) =>
      mods.map((m) =>
        m.id === 'whatsapp'
          ? { ...m, enabled: doc.theme?.enable_whatsapp_float ?? true }
          : m,
      ),
    );
  }

  getCurrentDocument(): CrmLandingDocument {
    return {
      schema_version: 1,
      theme: this.theme(),
      blocks: this.blocks(),
    };
  }

  saveLanding(): void {
    this.isSaving.set(true);
    const doc = this.getCurrentDocument();

    this.crmService
      .saveDraft(doc)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.serverDocument.set(doc);
          this.hasChanges.set(false);
          this.isSaving.set(false);
          this.toast.success('¡Landing guardada exitosamente!');
        },
        error: () => {
          this.toast.error('Ocurrió un error al guardar la landing');
          this.isSaving.set(false);
        },
      });
  }

  discardChanges(): void {
    const srv = this.serverDocument();
    if (srv) {
      this.resetFromDocument(srv);
      this.selectedIndex.set(null);
      this.hasChanges.set(false);
      this.toast.info('Cambios descartados');
    }
  }

  closeBuilder(): void {
    if (this.hasChanges()) {
      if (confirm('Tienes cambios sin guardar. ¿Deseas salir del constructor?')) {
        this.router.navigate(['/admin/customers/crm']);
      }
    } else {
      this.router.navigate(['/admin/customers/crm']);
    }
  }

  // --- Manejo del Dock Flotante ---
  toggleDrawer(drawer: ActiveDrawer): void {
    this.activeDrawer.update((cur) => (cur === drawer ? 'none' : drawer));
  }

  closeDrawer(): void {
    this.activeDrawer.set('none');
  }

  // --- Operaciones de Bloques & Selección con Mouse ---
  selectBlock(index: number, event?: Event): void {
    if (event) {
      event.stopPropagation();
    }
    this.selectedIndex.set(index);
  }

  openAiForBlock(index: number, event?: Event): void {
    if (event) {
      event.stopPropagation();
    }
    this.selectedIndex.set(index);
    this.activeDrawer.set('ai');
  }

  openEditForBlock(index: number, event?: Event): void {
    if (event) {
      event.stopPropagation();
    }
    this.selectedIndex.set(index);
    this.activeDrawer.set('edit-block');
  }

  clearSelection(event?: Event): void {
    if (event) {
      event.stopPropagation();
    }
    this.selectedIndex.set(null);
    if (this.activeDrawer() === 'edit-block') {
      this.activeDrawer.set('structure');
    }
  }

  onCanvasBackgroundClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (
      target.classList.contains('canvas-background') ||
      target.classList.contains('preview-stage') ||
      target.classList.contains('desktop-canvas-wrapper')
    ) {
      this.selectedIndex.set(null);
    }
  }

  deselectBlock(): void {
    this.clearSelection();
  }

  moveBlock(index: number, direction: -1 | 1): void {
    const target = index + direction;
    const current = [...this.blocks()];
    if (target < 0 || target >= current.length) return;
    [current[index], current[target]] = [current[target], current[index]];
    this.blocks.set(current);
    this.selectedIndex.set(target);
    this.hasChanges.set(true);
  }

  removeBlock(index: number, event?: Event): void {
    if (event) {
      event.stopPropagation();
    }
    const updated = this.blocks().filter((_, i) => i !== index);
    this.blocks.set(updated);
    if (this.selectedIndex() === index) {
      this.selectedIndex.set(null);
      this.activeDrawer.set('structure');
    }
    this.hasChanges.set(true);
    this.toast.success('Sección eliminada del lienzo');
  }

  openAddCatalog(): void {
    this.catalogModalOpen.set(true);
  }

  closeAddCatalog(): void {
    this.catalogModalOpen.set(false);
  }

  addBlockFromCatalog(type: CrmBlockType): void {
    const block: CrmBlock = {
      id: `${type}_${Date.now()}_${blockIdCounter++}`,
      type,
      props: Object.fromEntries(
        (CRM_BLOCK_FIELDS[type] || []).map((f) => [f.key, '']),
      ),
    };
    this.blocks.update((b) => [...b, block]);
    this.selectedIndex.set(this.blocks().length - 1);
    this.catalogModalOpen.set(false);
    this.activeDrawer.set('edit-block');
    this.hasChanges.set(true);
    this.toast.success(`Sección "${this.labelFor(type)}" agregada al lienzo`);
  }

  updateProp(key: string, value: string): void {
    const idx = this.selectedIndex();
    if (idx == null) return;
    const current = [...this.blocks()];
    const block = current[idx];
    if (!block) return;
    current[idx] = {
      ...block,
      props: {
        ...block.props,
        [key]: value,
      },
    };
    this.blocks.set(current);
    this.hasChanges.set(true);
  }

  // --- Presets de Estilo ---
  applyPreset(preset: StylePreset): void {
    this.theme.update((t) => ({
      ...t,
      primary_color: preset.primary_color,
      secondary_color: preset.secondary_color,
      border_radius: preset.border_radius,
    }));
    this.hasChanges.set(true);
    this.toast.success(`Estilo "${preset.name}" aplicado al lienzo`);
  }

  // --- Módulos Vendix ---
  toggleVendixModule(modId: 'products' | 'whatsapp' | 'locations'): void {
    this.vendixModules.update((mods) =>
      mods.map((m) => (m.id === modId ? { ...m, enabled: !m.enabled } : m)),
    );

    if (modId === 'whatsapp') {
      const isEnabled = this.vendixModules().find((m) => m.id === 'whatsapp')?.enabled ?? true;
      this.theme.update((t) => ({
        ...t,
        enable_whatsapp_float: isEnabled,
      }));
    } else if (modId === 'products') {
      const isEnabled = this.vendixModules().find((m) => m.id === 'products')?.enabled ?? true;
      if (!isEnabled) {
        const hasProducts = this.blocks().some((b) => b.type === 'products_grid');
        if (hasProducts) {
          this.toast.info('Sección de catálogo desactivada');
        }
      } else {
        const hasProducts = this.blocks().some((b) => b.type === 'products_grid');
        if (!hasProducts) {
          this.addBlockFromCatalog('products_grid');
        }
      }
    } else if (modId === 'locations') {
      const isEnabled = this.vendixModules().find((m) => m.id === 'locations')?.enabled ?? true;
      if (isEnabled) {
        const hasLoc = this.blocks().some((b) => b.type === 'location_hours');
        if (!hasLoc) {
          this.addBlockFromCatalog('location_hours');
        }
      }
    }

    this.hasChanges.set(true);
  }

  // --- Asistente IA ---
  setQuickPrompt(prompt: string): void {
    this.naturalPrompt.set(prompt);
  }

  processNaturalPrompt(): void {
    const prompt = this.naturalPrompt().trim();
    if (!prompt) {
      this.toast.error('Por favor escribe una instrucción para la IA');
      return;
    }

    this.isProcessingAi.set(true);

    const currentDoc: CrmLandingDocument = {
      schema_version: 1,
      theme: this.theme(),
      blocks: this.blocks(),
    };

    const targetBlock = this.selectedBlock();
    const selectedBlockId = targetBlock?.id;

    this.crmService
      .assistWithAi({
        prompt,
        current_document: currentDoc,
        selected_block_id: selectedBlockId,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.isProcessingAi.set(false);
          if (res.data?.document) {
            const doc = res.data.document;
            if (doc.theme) {
              this.theme.set({
                ...this.theme(),
                ...doc.theme,
              });
            }
            if (Array.isArray(doc.blocks) && doc.blocks.length > 0) {
              this.blocks.set(doc.blocks);
            }
            this.hasChanges.set(true);
            this.naturalPrompt.set('');
            this.toast.success(
              selectedBlockId
                ? `¡Sección "${this.labelFor(targetBlock!.type)}" actualizada con la IA de Vendix!`
                : '¡Landing page actualizada con la IA de Vendix!',
            );
          } else {
            this.toast.warning('La IA procesó la solicitud pero no devolvió cambios');
          }
        },
        error: (err) => {
          this.isProcessingAi.set(false);
          const devMessage =
            err?.error?.message ||
            'Error al conectar con la IA de Vendix. Intenta nuevamente.';
          this.toast.error(devMessage);
        },
      });
  }

  copyAgenticInstruction(): void {
    const text = `INSTRUCCIÓN AGÉNTICA PARA LA IA DE VENDIX (VEXI):
1. ANÁLISIS: Inspeccionar los datos comerciales de la tienda (Catálogo, Identidad, Sedes).
2. GENERACIÓN: Proponer o ajustar bloques de la landing page usando el esquema CrmLandingDocument.
3. ESTILOS: Aplicar la paleta de colores y componentes prediseñados de Vendix.
4. MÓDULOS: Conectar el catálogo de productos y el formulario de captura de clientes a la tabla 'users'.
5. DESPLIEGUE: Validar la previsualización en smartphone y laptop antes de publicar.`;

    navigator.clipboard.writeText(text).then(() => {
      this.copiedPrompt.set(true);
      this.toast.success('Instrucción agéntica copiada al portapapeles');
      setTimeout(() => this.copiedPrompt.set(false), 3000);
    });
  }

  // --- Auxiliares de Vista ---
  labelFor(type: CrmBlockType): string {
    return CRM_BLOCK_LABELS[type] || type;
  }

  iconFor(type: CrmBlockType): string {
    const map: Record<CrmBlockType, string> = {
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
    return map[type] || 'layout';
  }

  subtitleFor(type: CrmBlockType): string {
    const map: Record<CrmBlockType, string> = {
      hero: 'Portada y propuesta de valor',
      features: 'Beneficios, garantías y valores',
      products_grid: 'Catálogo de productos destacados',
      store_gallery: 'Fotos del local y vitrina',
      testimonials: 'Opiniones y reseñas de clientes',
      faq: 'Preguntas frecuentes y soporte',
      location_hours: 'Ubicación, sedes y horarios',
      promo_banner: 'Campaña o descuento temporal',
      about: 'Historia e identidad de la tienda',
      contact: 'Formulario de captura de prospectos',
      footer_cta: 'Cierre y botón de acción final',
    };
    return map[type] || 'Sección personalizada';
  }
}
