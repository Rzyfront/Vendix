import { Component, inject, signal } from '@angular/core';
import { RouterModule } from '@angular/router';
import { CommercialConsentService } from './commercial-consent.service';

/**
 * Aviso de cookies de la portada comercial (OPS-06 1.3). «Aceptar» y «Rechazar»
 * tienen el mismo tamaño; «Configurar» muestra las dos categorías (1.1).
 * No bloquea la página: se queda abajo hasta que el visitante elige.
 */
@Component({
  selector: 'app-commercial-consent-banner',
  standalone: true,
  imports: [RouterModule],
  template: `
    <section
      role="region"
      aria-labelledby="consent-banner-title"
      class="fixed inset-x-0 bottom-0 z-40 px-4 pb-4 sm:px-6"
    >
      <div
        class="mx-auto max-w-3xl rounded-2xl border border-emerald-900/60 bg-[#00170d] text-white shadow-2xl p-4 sm:p-5"
      >
        <p id="consent-banner-title" class="text-sm font-bold mb-1">
          Tu privacidad en Vendix
        </p>
        <p class="text-xs sm:text-sm text-emerald-100/80 leading-relaxed">
          Usamos cookies necesarias para que la página funcione. Si aceptas,
          también usamos Google Analytics para contar visitas y mejorar la web.
          No lo activamos sin tu permiso y puedes cambiar de opinión cuando
          quieras.
          <a
            routerLink="/legal/cookies"
            class="underline text-emerald-300 hover:text-emerald-200"
            >Política de cookies</a
          >
        </p>

        @if (configuring()) {
          <ul class="mt-3 flex flex-col gap-2 text-xs sm:text-sm">
            <li
              class="flex items-start justify-between gap-3 rounded-xl bg-white/5 px-3 py-2"
            >
              <span>
                <span class="font-semibold">Necesarias</span>
                <span class="block text-emerald-100/70">
                  Sesión, seguridad y tus preferencias. Siempre activas.
                </span>
              </span>
              <input
                type="checkbox"
                checked
                disabled
                aria-label="Cookies necesarias, siempre activas"
                class="mt-1 h-4 w-4 accent-emerald-500"
              />
            </li>
            <li
              class="flex items-start justify-between gap-3 rounded-xl bg-white/5 px-3 py-2"
            >
              <label for="consent-analytics" class="cursor-pointer">
                <span class="font-semibold">Analítica</span>
                <span class="block text-emerald-100/70">
                  Google Analytics: cuántas personas visitan la página. Nunca
                  enviamos tu nombre, correo ni teléfono.
                </span>
              </label>
              <input
                id="consent-analytics"
                type="checkbox"
                [checked]="analyticsDraft()"
                (change)="onAnalyticsToggle($event)"
                class="mt-1 h-4 w-4 accent-emerald-500 cursor-pointer"
              />
            </li>
          </ul>
        }

        <div class="mt-4 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
          <button
            type="button"
            (click)="consent.accept()"
            class="consent-btn bg-emerald-500 text-slate-950 hover:bg-emerald-400"
          >
            Aceptar
          </button>
          <button
            type="button"
            (click)="consent.reject()"
            class="consent-btn bg-white text-slate-950 hover:bg-emerald-50"
          >
            Rechazar
          </button>
          @if (configuring()) {
            <button
              type="button"
              (click)="save()"
              class="text-xs sm:text-sm font-semibold underline text-emerald-300 hover:text-emerald-200 sm:ml-auto"
            >
              Guardar mi elección
            </button>
          } @else {
            <button
              type="button"
              (click)="configure()"
              class="text-xs sm:text-sm font-semibold underline text-emerald-300 hover:text-emerald-200 sm:ml-auto"
            >
              Configurar
            </button>
          }
        </div>
      </div>
    </section>
  `,
  styles: [
    `
      .consent-btn {
        flex: 1 1 0;
        min-width: 9rem;
        padding: 0.625rem 1.25rem;
        border-radius: 0.75rem;
        font-size: 0.875rem;
        font-weight: 700;
        transition: background-color 150ms;
      }
    `,
  ],
})
export class CommercialConsentBannerComponent {
  readonly consent = inject(CommercialConsentService);
  readonly configuring = signal(false);
  readonly analyticsDraft = signal(false);

  configure(): void {
    this.analyticsDraft.set(this.consent.currentChoice() === true);
    this.configuring.set(true);
  }

  onAnalyticsToggle(event: Event): void {
    this.analyticsDraft.set((event.target as HTMLInputElement).checked);
  }

  save(): void {
    if (this.analyticsDraft()) {
      this.consent.accept();
    } else {
      this.consent.reject();
    }
  }
}
