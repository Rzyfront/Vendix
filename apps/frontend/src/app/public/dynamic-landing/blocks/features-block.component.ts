import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { IconName } from '../../../shared/components/icon/icons.registry';

interface FeatureItem {
  icon?: string;
  title: string;
  description: string;
}

const ICON_FALLBACK_MAP: Record<string, IconName> = {
  tienda: 'store',
  local: 'store',
  store: 'store',
  garantia: 'shield-check',
  garantía: 'shield-check',
  seguridad: 'shield-check',
  shield: 'shield-check',
  rayo: 'zap',
  rapidez: 'zap',
  inmediato: 'zap',
  envio: 'truck',
  envios: 'truck',
  envíos: 'truck',
  entrega: 'truck',
  truck: 'truck',
  soporte: 'headphones',
  asesoria: 'headphones',
  asesoría: 'headphones',
  atencion: 'headphones',
  estrella: 'star',
  calidad: 'star',
  star: 'star',
  ubicacion: 'map-pin',
  ubicación: 'map-pin',
  map: 'map-pin',
  precio: 'tag',
  oferta: 'tag',
  descuento: 'tag',
};

/**
 * Beneficios y propuesta de valor de la tienda.
 * Props: title?, items (array de objetos o string multilínea "Título | Descripción").
 */
@Component({
  selector: 'app-features-block',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, IconComponent],
  template: `
    <section class="features-container max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
      <div class="text-center max-w-3xl mx-auto mb-10 sm:mb-14">
        <div class="features-badge inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full text-xs font-semibold mb-3">
          <app-icon name="check-circle" [size]="13" [color]="'var(--crm-primary, #2563eb)'" />
          <span>Propuesta de Valor</span>
        </div>
        <h2 class="text-2xl sm:text-3xl md:text-4xl font-extrabold text-slate-900 tracking-tight">
          {{ props()['title'] || 'Por qué elegirnos' }}
        </h2>
      </div>

      <div class="features-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8">
        @for (item of items(); track item.title + $index) {
          <article class="feature-card group relative bg-white rounded-2xl p-6 sm:p-7 border border-slate-200/80 shadow-xs hover:shadow-xl hover:-translate-y-1.5 transition-all duration-300">
            <!-- Icon Box -->
            <div class="feature-icon-box w-12 h-12 rounded-xl flex items-center justify-center mb-5 transition-transform duration-300 group-hover:scale-110">
              <app-icon
                [name]="resolveIcon(item.icon, $index)"
                [size]="22"
                [color]="'var(--crm-primary, #2563eb)'"
              />
            </div>

            <!-- Content -->
            <h3 class="text-lg font-bold text-slate-900 mb-2.5 group-hover:text-primary transition-colors duration-200">
              {{ item.title }}
            </h3>
            <p class="text-sm text-slate-600 leading-relaxed">
              {{ item.description }}
            </p>
          </article>
        }
      </div>
    </section>
  `,
  styles: [
    `
      .features-badge {
        background: rgba(37, 99, 235, 0.08);
        color: var(--crm-primary, #2563eb);
      }
      .feature-card {
        background: #ffffff;
      }
      .feature-icon-box {
        background: rgba(37, 99, 235, 0.1);
      }
    `,
  ],
})
export class FeaturesBlockComponent {
  readonly props = input.required<Record<string, unknown>>();

  readonly items = computed<FeatureItem[]>(() => {
    const raw = this.props()['items'];
    if (!raw) return [];
    if (Array.isArray(raw)) {
      return (raw as any[]).map((it) => ({
        icon: it?.icon ? String(it.icon) : undefined,
        title: String(it?.title || it?.name || ''),
        description: String(it?.description || it?.desc || ''),
      }));
    }
    if (typeof raw === 'string') {
      return raw
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [title, description = ''] = line.split('|');
          return { title: title.trim(), description: description.trim() };
        });
    }
    return [];
  });

  resolveIcon(rawIcon?: string, index: number = 0): IconName {
    if (rawIcon) {
      const normalized = rawIcon.toLowerCase().trim();
      if (ICON_FALLBACK_MAP[normalized]) {
        return ICON_FALLBACK_MAP[normalized];
      }
      return 'check-circle';
    }
    const defaults: IconName[] = ['shield-check', 'truck', 'star', 'store', 'headphones', 'zap'];
    return defaults[index % defaults.length];
  }
}
