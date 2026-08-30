import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../../../shared/components/icon/icon.component';

/**
 * Sección "Sobre el negocio" (About).
 * Props: title?, body (párrafos de historia).
 */
@Component({
  selector: 'app-about-block',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, IconComponent],
  template: `
    <section class="about-container max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-14 items-center">
        <!-- Story Column -->
        <div class="lg:col-span-7">
          <div class="about-badge inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full text-xs font-semibold mb-4">
            <app-icon name="building" [size]="13" [color]="'var(--crm-primary, #2563eb)'" />
            <span>Nuestra Historia</span>
          </div>

          <h2 class="text-2xl sm:text-3xl md:text-4xl font-extrabold text-slate-900 tracking-tight mb-6">
            {{ props()['title'] || 'Conoce nuestra historia' }}
          </h2>

          <div class="about-paragraphs space-y-4 text-base sm:text-lg text-slate-600 leading-relaxed">
            @for (paragraph of paragraphs(); track $index) {
              <p>{{ paragraph }}</p>
            }
          </div>
        </div>

        <!-- Trust / Authority Card Column -->
        <div class="lg:col-span-5">
          <div class="about-card bg-white rounded-3xl p-7 sm:p-8 border border-slate-200/90 shadow-lg relative overflow-hidden">
            <div class="absolute -top-10 -right-10 w-40 h-40 bg-blue-50 rounded-full blur-2xl pointer-events-none"></div>

            <div class="flex items-center gap-3 mb-6">
              <div class="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-primary">
                <app-icon name="shield-check" [size]="20" [color]="'var(--crm-primary, #2563eb)'" />
              </div>
              <div>
                <h3 class="font-bold text-slate-900 text-base">Comercio Legal y Certificado</h3>
                <span class="text-xs text-slate-500">Operación transparente y garantizada</span>
              </div>
            </div>

            <div class="space-y-4 pt-2 border-t border-slate-100">
              <div class="flex items-start gap-3">
                <div class="p-1 rounded-full bg-emerald-100 text-emerald-600 mt-0.5">
                  <app-icon name="check" [size]="12" color="#059669" />
                </div>
                <div class="text-sm text-slate-700">
                  <strong class="font-semibold text-slate-900 block">Facturación & Garantía</strong>
                  Emitimos comprobantes oficiales y brindamos respaldo directo sobre todos los productos.
                </div>
              </div>

              <div class="flex items-start gap-3">
                <div class="p-1 rounded-full bg-blue-100 text-blue-600 mt-0.5">
                  <app-icon name="check" [size]="12" color="#2563eb" />
                </div>
                <div class="text-sm text-slate-700">
                  <strong class="font-semibold text-slate-900 block">Atención Personalizada</strong>
                  Asesoría técnica y comercial en punto de venta o a través de nuestros canales digitales.
                </div>
              </div>

              <div class="flex items-start gap-3">
                <div class="p-1 rounded-full bg-amber-100 text-amber-600 mt-0.5">
                  <app-icon name="check" [size]="12" color="#d97706" />
                </div>
                <div class="text-sm text-slate-700">
                  <strong class="font-semibold text-slate-900 block">Compra Segura</strong>
                  Diversos métodos de pago y despacho oportuno con trazabilidad.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  `,
  styles: [
    `
      .about-badge {
        background: rgba(37, 99, 235, 0.08);
        color: var(--crm-primary, #2563eb);
      }
      .about-card {
        background: #ffffff;
      }
    `,
  ],
})
export class AboutBlockComponent {
  readonly props = input.required<Record<string, unknown>>();

  readonly paragraphs = computed<string[]>(() => {
    const body = this.props()['body'];
    if (!body) return [];
    if (Array.isArray(body)) {
      return body.map((p) => String(p).trim()).filter(Boolean);
    }
    if (typeof body === 'string') {
      return body
        .split(/\n+/)
        .map((p) => p.trim())
        .filter(Boolean);
    }
    return [String(body)];
  });
}
