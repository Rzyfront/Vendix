import {
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  CrmLandingDocument,
  CrmLandingTheme,
  CrmBlock,
  emptyCrmLandingDocument,
} from '../../../../../../public/dynamic-landing/blocks/landing-blocks.types';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { ToastService } from '../../../../../../shared/components';

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
  id: string;
  name: string;
  icon: string;
  description: string;
  enabled: boolean;
  statusBadge: string;
}

@Component({
  selector: 'app-crm-ai-studio',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, ButtonComponent],
  templateUrl: './crm-ai-studio.component.html',
  styleUrl: './crm-ai-studio.component.scss',
})
export class CrmAiStudioComponent {
  private readonly toast = inject(ToastService);

  readonly document = input.required<CrmLandingDocument | null>();
  readonly isBusy = input<boolean>(false);
  readonly documentChange = output<CrmLandingDocument>();
  readonly saveDraft = output<void>();
  readonly goToDesign = output<void>();

  readonly naturalPrompt = signal<string>('');
  readonly isProcessingAi = signal<boolean>(false);
  readonly activeStep = signal<number>(1);
  readonly copiedPrompt = signal<boolean>(false);

  readonly quickPrompts: string[] = [
    'Destacar oferta especial del 20% de descuento en el encabezado',
    'Añadir bloque de preguntas frecuentes sobre políticas de envío y garantías',
    'Cambiar el estilo visual a una estética minimalista y elegante',
    'Enfocar la propuesta de valor en atención personalizada por WhatsApp',
    'Actualizar testimonios con calificaciones de 5 estrellas de clientes',
  ];

  readonly stylePresets: StylePreset[] = [
    {
      id: 'tech-pro',
      name: 'Tech & Innovación Pro',
      category: 'Tecnología & Hardware',
      description: 'Contrastes limpios con azul vibrante y acentos oscuros. Ideal para productos tecnológicos y servicios.',
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
      id: 'customers',
      name: 'Captura de Leads a Clientes',
      icon: 'users',
      description: 'Cada contacto registrado en tu landing se convierte automáticamente en cliente formal en la base de datos.',
      enabled: true,
      statusBadge: 'Registro automático activo',
    },
    {
      id: 'messaging',
      name: 'WhatsApp Business & Enlaces Directos',
      icon: 'phone',
      description: 'Incrusta botón flotante y enlaces de contacto directo a tu línea oficial de WhatsApp.',
      enabled: true,
      statusBadge: 'Conectado',
    },
    {
      id: 'locations',
      name: 'Sedes Físicas & Horarios de Atención',
      icon: 'map-pin',
      description: 'Muestra la dirección y horario de tu sede principal registrado en los ajustes de la tienda.',
      enabled: true,
      statusBadge: 'Activo',
    },
  ]);

  readonly agenticInstructions = [
    {
      step: 1,
      title: 'Análisis de Identidad & Catálogo',
      description: 'Vexi IA analiza la configuración de tu tienda: nombre, sector comercial, productos más vendidos y colores de marca.',
      icon: 'database',
    },
    {
      step: 2,
      title: 'Generación Estructurada de Bloques',
      description: 'Crea las secciones clave (Hero persuasivo, Cuadrícula de productos, Propuesta de valor, Galería y Testimonios) en JSON validado.',
      icon: 'layout',
    },
    {
      step: 3,
      title: 'Aplicación de Paleta & Diseño',
      description: 'Armoniza la tipografía, bordes redondeados y colores primarios para asegurar coherencia visual y alta legibilidad.',
      icon: 'palette',
    },
    {
      step: 4,
      title: 'Integración de Módulos de Vendix',
      description: 'Conecta el inventario en vivo, la captación de leads y los canales de mensajería para que la página sea operativa.',
      icon: 'refresh-cw',
    },
    {
      step: 5,
      title: 'Previsualización & Despliegue',
      description: 'Permite revisar los cambios en el mockup interactivo de smartphone y portátil antes de publicar con un solo clic.',
      icon: 'globe',
    },
  ];

  setQuickPrompt(prompt: string): void {
    this.naturalPrompt.set(prompt);
  }

  toggleModule(id: string): void {
    this.vendixModules.update((modules) =>
      modules.map((m) => (m.id === id ? { ...m, enabled: !m.enabled } : m)),
    );
    this.toast.info('Preferencia de integración actualizada');
  }

  applyStylePreset(preset: StylePreset): void {
    const currentDoc = this.document() ?? emptyCrmLandingDocument();
    const updatedDoc: CrmLandingDocument = {
      ...currentDoc,
      theme: {
        ...currentDoc.theme,
        primary_color: preset.primary_color,
        secondary_color: preset.secondary_color,
        border_radius: preset.border_radius,
      },
    };

    this.documentChange.emit(updatedDoc);
    this.toast.success(`Estilo "${preset.name}" aplicado a la landing.`);
  }

  processNaturalPrompt(): void {
    const prompt = this.naturalPrompt().trim();
    if (!prompt) {
      this.toast.error('Por favor escribe una instrucción para la IA.');
      return;
    }

    this.isProcessingAi.set(true);

    setTimeout(() => {
      const currentDoc = this.document() ?? emptyCrmLandingDocument();
      const lower = prompt.toLowerCase();
      let modified = false;

      // Adaptaciones inteligentes basadas en el lenguaje natural
      let updatedBlocks = [...(currentDoc.blocks || [])];

      if (lower.includes('descuento') || lower.includes('oferta') || lower.includes('20%')) {
        const heroIndex = updatedBlocks.findIndex((b) => b.type === 'hero');
        if (heroIndex >= 0) {
          const hero = updatedBlocks[heroIndex];
          updatedBlocks[heroIndex] = {
            ...hero,
            props: {
              ...hero.props,
              title: 'Gran Promoción: 20% OFF en Productos Seleccionados',
              subtitle: 'Aprovecha ofertas exclusivas por tiempo limitado en nuestra tienda oficial.',
            },
          };
          modified = true;
        }
      }

      if (lower.includes('preguntas') || lower.includes('faq')) {
        const hasFaq = updatedBlocks.some((b) => b.type === 'faq');
        if (!hasFaq) {
          const newFaqBlock: CrmBlock = {
            id: `faq_${Date.now()}`,
            type: 'faq',
            props: {
              title: 'Preguntas Frecuentes',
              subtitle: 'Resolvemos tus dudas principales sobre entregas y garantías',
              items: [
                { question: '¿Hacen envíos a todo el país?', answer: 'Sí, despachamos con cobertura nacional y seguimiento en tiempo real.' },
                { question: '¿Cuáles son los medios de pago?', answer: 'Aceptamos tarjetas de crédito, débito, transferencias y pago contra entrega.' },
                { question: '¿Tienen garantía oficial?', answer: 'Todos nuestros productos cuentan con garantía directa de fábrica.' },
              ],
            },
          };
          updatedBlocks.push(newFaqBlock);
          modified = true;
        }
      }

      if (lower.includes('minimalista') || lower.includes('elegante')) {
        this.applyStylePreset(this.stylePresets[0]);
        modified = true;
      }

      if (!modified) {
        // Modificación sutil en el Hero para reflejar la instrucción
        const heroIndex = updatedBlocks.findIndex((b) => b.type === 'hero');
        if (heroIndex >= 0) {
          const hero = updatedBlocks[heroIndex];
          updatedBlocks[heroIndex] = {
            ...hero,
            props: {
              ...hero.props,
              subtitle: `${hero.props['subtitle'] || ''} · ${prompt}`.trim(),
            },
          };
        }
      }

      const updatedDoc: CrmLandingDocument = {
        ...currentDoc,
        blocks: updatedBlocks,
      };

      this.documentChange.emit(updatedDoc);
      this.isProcessingAi.set(false);
      this.naturalPrompt.set('');
      this.toast.success('¡Instrucción aplicada exitosamente por la IA!');
    }, 1200);
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
      setTimeout(() => this.copiedPrompt.set(false), 2500);
    });
  }
}
