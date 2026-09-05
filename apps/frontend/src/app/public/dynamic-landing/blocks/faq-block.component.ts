import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../../../shared/components/icon/icon.component';

interface FaqItem {
  question: string;
  answer: string;
}

const DEFAULT_FAQS: FaqItem[] = [
  {
    question: '¿Qué medios de pago reciben en la tienda y en línea?',
    answer: 'Aceptamos transferencias bancarias directas (Bancolombia, Nequi, Daviplata), tarjetas de crédito/débito, pagos PSE y pago en efectivo en nuestro punto de atención.',
  },
  {
    question: '¿Los productos cuentan con garantía oficial y factura legal?',
    answer: 'Sí, el 100% de nuestros productos se entregan con factura electrónica oficial y garantía directa que cubre cualquier defecto de fábrica según las políticas de cada marca.',
  },
  {
    question: '¿Cómo funcionan los envíos a nivel local y nacional?',
    answer: 'En Bogotá ofrecemos entregas el mismo día o al día siguiente en franjas acordadas. A nivel nacional realizamos despachos con guías aseguradas a través de transportadoras aliadas.',
  },
  {
    question: '¿Puedo visitar su punto físico para ver o probar los equipos?',
    answer: '¡Por supuesto! Contamos con instalaciones físicas donde puedes recibir asesoría personalizada de un especialista y ensayar tus equipos antes de llevártelos.',
  },
];

/**
 * Preguntas Frecuentes (FAQ) con acordeón interactivo.
 * Props: title?, subtitle?, items (array o string "Pregunta | Respuesta").
 */
@Component({
  selector: 'app-faq-block',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, IconComponent],
  template: `
    <section class="faq-container max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
      <div class="text-center max-w-2xl mx-auto mb-10 sm:mb-12">
        <div class="faq-badge inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full text-xs font-semibold mb-3">
          <app-icon name="help-circle" [size]="13" [color]="'var(--crm-primary, #2563eb)'" />
          <span>Preguntas Frecuentes</span>
        </div>
        <h2 class="text-2xl sm:text-3xl md:text-4xl font-extrabold text-slate-900 tracking-tight mb-3">
          {{ props()['title'] || 'Resolvemos todas tus dudas' }}
        </h2>
        @if (props()['subtitle']) {
          <p class="text-base sm:text-lg text-slate-600">
            {{ props()['subtitle'] }}
          </p>
        }
      </div>

      <div class="space-y-3.5">
        @for (item of items(); track item.question + $index) {
          <div
            class="faq-card bg-white rounded-2xl border border-slate-200/90 overflow-hidden shadow-xs transition-all duration-200"
            [class.border-blue-400]="isOpen($index)"
          >
            <button
              type="button"
              class="w-full p-5 sm:p-6 text-left flex items-center justify-between gap-4 font-bold text-slate-900 text-base sm:text-lg cursor-pointer"
              (click)="toggle($index)"
            >
              <span>{{ item.question }}</span>
              <div class="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0 text-slate-600 transition-transform duration-200" [class.rotate-180]="isOpen($index)">
                <app-icon name="chevron-down" [size]="16" />
              </div>
            </button>

            @if (isOpen($index)) {
              <div class="px-5 sm:px-6 pb-6 pt-1 text-slate-600 text-sm sm:text-base leading-relaxed border-t border-slate-100/70">
                <p>{{ item.answer }}</p>
              </div>
            }
          </div>
        }
      </div>
    </section>
  `,
  styles: [
    `
      .faq-badge {
        background: rgba(37, 99, 235, 0.08);
        color: var(--crm-primary, #2563eb);
      }
      .faq-card {
        background: #ffffff;
      }
    `,
  ],
})
export class FaqBlockComponent {
  readonly props = input.required<Record<string, unknown>>();
  readonly openIndices = signal<Set<number>>(new Set([0]));

  readonly items = computed<FaqItem[]>(() => {
    const raw = this.props()['items'];
    if (!raw) return DEFAULT_FAQS;

    if (Array.isArray(raw)) {
      const parsed = (raw as any[])
        .map((it) => ({
          question: String(it.question || it.title || ''),
          answer: String(it.answer || it.description || ''),
        }))
        .filter((i) => i.question.length > 0 && i.answer.length > 0);
      return parsed.length > 0 ? parsed : DEFAULT_FAQS;
    }

    if (typeof raw === 'string') {
      const parsed = raw
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [question, answer = ''] = line.split('|');
          return { question: question.trim(), answer: answer.trim() };
        })
        .filter((i) => i.question.length > 0 && i.answer.length > 0);
      return parsed.length > 0 ? parsed : DEFAULT_FAQS;
    }

    return DEFAULT_FAQS;
  });

  isOpen(index: number): boolean {
    return this.openIndices().has(index);
  }

  toggle(index: number): void {
    const current = new Set(this.openIndices());
    if (current.has(index)) {
      current.delete(index);
    } else {
      current.add(index);
    }
    this.openIndices.set(current);
  }
}
