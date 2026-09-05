import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../../../shared/components/icon/icon.component';

interface GalleryItem {
  title?: string;
  url: string;
}

const DEFAULT_GALLERY_FALLBACKS: GalleryItem[] = [
  {
    title: 'Showroom Principal & Equipos',
    url: 'https://images.unsplash.com/photo-1550009158-9ebf69173e03?auto=format&fit=crop&w=800&q=80',
  },
  {
    title: 'Punto de Atención & Asesoría',
    url: 'https://images.unsplash.com/photo-1531297484001-80022131f5a1?auto=format&fit=crop&w=800&q=80',
  },
  {
    title: 'Vitrinas de Tecnología & Accesorios',
    url: 'https://images.unsplash.com/photo-1526738549149-8e07eca6c147?auto=format&fit=crop&w=800&q=80',
  },
  {
    title: 'Taller de Soporte & Garantía',
    url: 'https://images.unsplash.com/photo-1588508065123-287b28e013da?auto=format&fit=crop&w=800&q=80',
  },
];

/**
 * Galería de fotos del local físico y vitrina.
 * Props: title?, subtitle?, images (array de URLs o texto multilínea "Título | URL").
 */
@Component({
  selector: 'app-gallery-block',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, IconComponent],
  template: `
    <section class="gallery-container max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
      <div class="text-center max-w-3xl mx-auto mb-10 sm:mb-14">
        <div class="gallery-badge inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full text-xs font-semibold mb-3">
          <app-icon name="image" [size]="13" [color]="'var(--crm-primary, #2563eb)'" />
          <span>Nuestras Instalaciones</span>
        </div>
        <h2 class="text-2xl sm:text-3xl md:text-4xl font-extrabold text-slate-900 tracking-tight mb-3">
          {{ props()['title'] || 'Conoce nuestra tienda física y vitrinas' }}
        </h2>
        @if (props()['subtitle']) {
          <p class="text-base sm:text-lg text-slate-600 max-w-2xl mx-auto">
            {{ props()['subtitle'] }}
          </p>
        }
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        @for (item of items(); track item.url + $index) {
          <div class="gallery-card group relative bg-slate-100 rounded-2xl overflow-hidden aspect-[4/3] sm:aspect-square shadow-sm hover:shadow-xl transition-all duration-300">
            <img
              [src]="item.url"
              [alt]="item.title || 'Foto de la tienda'"
              loading="lazy"
              class="w-full h-full object-cover group-hover:scale-108 transition-transform duration-500"
            />
            <div class="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-slate-950/20 to-transparent opacity-80 group-hover:opacity-95 transition-opacity"></div>

            <div class="absolute bottom-0 left-0 right-0 p-4 text-white">
              @if (item.title) {
                <span class="block text-xs font-bold tracking-wide uppercase text-white/90 drop-shadow-xs">
                  {{ item.title }}
                </span>
              }
              <div class="flex items-center gap-1 text-[11px] text-white/75 mt-0.5">
                <app-icon name="shield-check" [size]="12" color="#34d399" />
                <span>Punto Oficial</span>
              </div>
            </div>
          </div>
        }
      </div>
    </section>
  `,
  styles: [
    `
      .gallery-badge {
        background: rgba(37, 99, 235, 0.08);
        color: var(--crm-primary, #2563eb);
      }
    `,
  ],
})
export class GalleryBlockComponent {
  readonly props = input.required<Record<string, unknown>>();

  readonly items = computed<GalleryItem[]>(() => {
    const raw = this.props()['images'];
    if (!raw) return DEFAULT_GALLERY_FALLBACKS;

    if (Array.isArray(raw)) {
      const parsed = (raw as any[])
        .map((img) => {
          if (typeof img === 'string') return { url: img };
          if (img && typeof img === 'object' && img.url) return { title: img.title, url: String(img.url) };
          return null;
        })
        .filter((i): i is GalleryItem => !!i && !!i.url);
      return parsed.length > 0 ? parsed : DEFAULT_GALLERY_FALLBACKS;
    }

    if (typeof raw === 'string') {
      const parsed = raw
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          if (line.includes('|')) {
            const [title, url = ''] = line.split('|');
            return { title: title.trim(), url: url.trim() };
          }
          return { url: line.trim() };
        })
        .filter((i) => !!i.url && (i.url.startsWith('http') || i.url.startsWith('/')));
      return parsed.length > 0 ? parsed : DEFAULT_GALLERY_FALLBACKS;
    }

    return DEFAULT_GALLERY_FALLBACKS;
  });
}
