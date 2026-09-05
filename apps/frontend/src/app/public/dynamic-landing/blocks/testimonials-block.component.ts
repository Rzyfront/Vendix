import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../../../shared/components/icon/icon.component';

interface TestimonialItem {
  name: string;
  role: string;
  comment: string;
  stars: number;
}

const DEFAULT_TESTIMONIALS: TestimonialItem[] = [
  {
    name: 'Carlos Mendoza',
    role: 'Bogotá · Cliente Verificado',
    comment: 'Compré un portátil para mi empresa. La atención en el punto de venta fue excelente, me entregaron factura electrónica legal y garantía sellada de 1 año.',
    stars: 5,
  },
  {
    name: 'Valentina Restrepo',
    role: 'Medellín · Comprador Frecuente',
    comment: 'El despacho fue súper rápido y el equipo llegó en perfecto estado. Me asesoraron por WhatsApp antes de pagar para elegir la mejor configuración.',
    stars: 5,
  },
  {
    name: 'Jorge Eliécer Díaz',
    role: 'Chía · Empresa Tecnológica',
    comment: 'Llevamos más de 2 años adquiriendo periféricos y componentes con ellos. Cumplimiento, seriedad y precios muy competitivos.',
    stars: 5,
  },
];

/**
 * Reseñas y testimonios de clientes (Prueba Social).
 * Props: title?, subtitle?, items (array de objetos o string "Nombre | Rol | Comentario").
 */
@Component({
  selector: 'app-testimonials-block',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, IconComponent],
  template: `
    <section class="testimonials-container max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
      <div class="text-center max-w-3xl mx-auto mb-10 sm:mb-14">
        <div class="testimonials-badge inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full text-xs font-semibold mb-3">
          <app-icon name="star" [size]="13" [color]="'var(--crm-primary, #2563eb)'" />
          <span>Opiniones Reales</span>
        </div>
        <h2 class="text-2xl sm:text-3xl md:text-4xl font-extrabold text-slate-900 tracking-tight mb-3">
          {{ props()['title'] || 'Lo que dicen nuestros clientes' }}
        </h2>
        @if (props()['subtitle']) {
          <p class="text-base sm:text-lg text-slate-600 max-w-2xl mx-auto">
            {{ props()['subtitle'] }}
          </p>
        }
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8">
        @for (item of items(); track item.name + $index) {
          <article class="testimonial-card bg-white rounded-3xl p-6 sm:p-8 border border-slate-200/80 shadow-sm hover:shadow-xl hover:-translate-y-1.5 transition-all duration-300 flex flex-col justify-between">
            <div>
              <!-- Star Rating -->
              <div class="flex items-center gap-1 mb-4">
                @for (s of [1, 2, 3, 4, 5]; track s) {
                  <app-icon name="star" [size]="16" color="#f59e0b" />
                }
                <span class="text-xs font-bold text-amber-600 ml-1.5">5.0</span>
              </div>

              <!-- Comment Quote -->
              <p class="text-sm sm:text-base text-slate-700 leading-relaxed italic mb-6">
                "{{ item.comment }}"
              </p>
            </div>

            <!-- Author info -->
            <div class="flex items-center gap-3 pt-4 border-t border-slate-100">
              <div class="w-10 h-10 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center font-bold text-slate-700 text-sm">
                {{ item.name.charAt(0) }}
              </div>
              <div>
                <h4 class="font-bold text-slate-900 text-sm">{{ item.name }}</h4>
                <div class="flex items-center gap-1 text-xs text-slate-500">
                  <app-icon name="check-circle" [size]="12" color="#059669" />
                  <span>{{ item.role }}</span>
                </div>
              </div>
            </div>
          </article>
        }
      </div>
    </section>
  `,
  styles: [
    `
      .testimonials-badge {
        background: rgba(37, 99, 235, 0.08);
        color: var(--crm-primary, #2563eb);
      }
      .testimonial-card {
        background: #ffffff;
      }
    `,
  ],
})
export class TestimonialsBlockComponent {
  readonly props = input.required<Record<string, unknown>>();

  readonly items = computed<TestimonialItem[]>(() => {
    const raw = this.props()['items'];
    if (!raw) return DEFAULT_TESTIMONIALS;

    if (Array.isArray(raw)) {
      const parsed = (raw as any[])
        .map((it) => ({
          name: String(it.name || it.author || 'Cliente'),
          role: String(it.role || it.city || 'Comprador verificado'),
          comment: String(it.comment || it.quote || it.description || ''),
          stars: Number(it.stars || 5),
        }))
        .filter((i) => i.comment.length > 0);
      return parsed.length > 0 ? parsed : DEFAULT_TESTIMONIALS;
    }

    if (typeof raw === 'string') {
      const parsed = raw
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const parts = line.split('|');
          return {
            name: parts[0]?.trim() || 'Cliente Satisfecho',
            role: parts[1]?.trim() || 'Comprador Verificado',
            comment: parts[2]?.trim() || parts[0]?.trim(),
            stars: 5,
          };
        });
      return parsed.length > 0 ? parsed : DEFAULT_TESTIMONIALS;
    }

    return DEFAULT_TESTIMONIALS;
  });
}
