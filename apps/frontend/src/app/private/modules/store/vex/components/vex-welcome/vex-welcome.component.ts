import { Component, computed, inject } from '@angular/core';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { VexChatStore } from '../../state/vex-chat.store';

const SUGGESTIONS: string[] = [
  'Resumen de ventas de hoy',
  '¿Qué productos debo reabastecer?',
  'Cuadre de caja',
  'Clientes con cartera vencida',
];

@Component({
  selector: 'vendix-vex-welcome',
  standalone: true,
  template: `
    <div class="flex flex-col items-center text-center gap-6 w-full">
      <h1
        class="text-3xl md:text-4xl font-normal text-[var(--color-text-primary)]"
      >
        {{ greeting() }}
      </h1>
      <div class="flex flex-wrap justify-center gap-2">
        @for (suggestion of suggestions; track suggestion) {
          <button
            type="button"
            class="min-h-10 px-4 py-2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
            (click)="store.sendMessage(suggestion)"
          >
            {{ suggestion }}
          </button>
        }
      </div>
    </div>
  `,
})
export class VexWelcomeComponent {
  readonly store = inject(VexChatStore);
  private readonly auth = inject(AuthFacade);

  readonly suggestions = SUGGESTIONS;

  readonly greeting = computed(() => {
    const first_name = (this.auth.user()?.first_name as string | undefined)?.trim();
    return first_name
      ? `¿Con qué seguimos, ${first_name}?`
      : '¿Con qué seguimos?';
  });
}
