import {
  ChangeDetectionStrategy,
  Component,
  input,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../../../shared/components/icon/icon.component';

/**
 * Ubicación y Horarios de atención de la tienda física.
 * Props: title?, address?, hours?, phone?, maps_url?.
 */
@Component({
  selector: 'app-location-block',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, IconComponent],
  template: `
    <section class="location-container max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
      <div class="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-3xl p-8 sm:p-12 text-white shadow-xl relative overflow-hidden">
        <div class="absolute -right-20 -bottom-20 w-80 h-80 bg-blue-500/10 rounded-full blur-3xl pointer-events-none"></div>

        <div class="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center relative z-10">
          <div class="lg:col-span-7">
            <div class="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full text-xs font-semibold bg-white/10 text-white/90 border border-white/20 mb-4 backdrop-blur-xs">
              <app-icon name="map-pin" [size]="13" color="#60a5fa" />
              <span>Visítanos en Persona</span>
            </div>

            <h2 class="text-2xl sm:text-3xl md:text-4xl font-extrabold tracking-tight mb-4 leading-tight">
              {{ props()['title'] || 'Encuéntranos en nuestro punto físico' }}
            </h2>

            <div class="space-y-4 text-slate-300 text-sm sm:text-base mt-6">
              <div class="flex items-start gap-3">
                <div class="p-2 rounded-xl bg-white/10 text-blue-400 mt-0.5">
                  <app-icon name="map-pin" [size]="18" color="#60a5fa" />
                </div>
                <div>
                  <strong class="text-white block font-semibold">Dirección Comercial:</strong>
                  <span>{{ props()['address'] || 'Carrera 15 # 93-60, Chico Norte, Bogotá D.C.' }}</span>
                </div>
              </div>

              <div class="flex items-start gap-3">
                <div class="p-2 rounded-xl bg-white/10 text-emerald-400 mt-0.5">
                  <app-icon name="clock" [size]="18" color="#34d399" />
                </div>
                <div>
                  <strong class="text-white block font-semibold">Horarios de Atención:</strong>
                  <span>{{ props()['hours'] || 'Lunes a Sábado: 9:00 AM a 7:00 PM | Domingos: 10:00 AM a 3:00 PM' }}</span>
                </div>
              </div>

              @if (props()['phone']) {
                <div class="flex items-start gap-3">
                  <div class="p-2 rounded-xl bg-white/10 text-amber-400 mt-0.5">
                    <app-icon name="phone" [size]="18" color="#fbbf24" />
                  </div>
                  <div>
                    <strong class="text-white block font-semibold">Línea Directa / WhatsApp:</strong>
                    <span>{{ props()['phone'] }}</span>
                  </div>
                </div>
              }
            </div>
          </div>

          <div class="lg:col-span-5 flex flex-col sm:flex-row lg:flex-col gap-3.5 justify-center">
            @if (props()['maps_url']) {
              <a
                [href]="props()['maps_url']"
                target="_blank"
                rel="noopener"
                class="inline-flex items-center justify-center gap-2.5 px-6 py-4 rounded-full bg-white text-slate-900 font-bold text-sm shadow-lg hover:bg-slate-100 transition-all duration-200"
              >
                <app-icon name="map-pin" [size]="18" color="#2563eb" />
                <span>Abrir en Google Maps / Waze</span>
              </a>
            }

            <a
              href="#contacto"
              class="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-full bg-white/10 text-white font-semibold text-sm border border-white/20 hover:bg-white/20 transition-all duration-200"
            >
              <app-icon name="headphones" [size]="17" color="white" />
              <span>Contactar Asesor en Tienda</span>
            </a>
          </div>
        </div>
      </div>
    </section>
  `,
})
export class LocationBlockComponent {
  readonly props = input.required<Record<string, string>>();
}
