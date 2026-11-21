import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { VexApiService } from '../../services/vex-api.service';
import { VexChatStore } from '../../state/vex-chat.store';
import {
  VexServerSuggestion,
  resolveWelcomeSuggestions,
} from '../../state/vex-suggestions.util';
import { VEX_COPY } from '../../vex-copy';

/**
 * Empty state of the Vex page: a greeting, the questions that fit what the
 * store has pending today, and the way into «¿Cómo funciona Vex?».
 */
@Component({
  selector: 'vendix-vex-welcome',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonComponent],
  template: `
    <div class="flex flex-col items-center text-center gap-6 w-full">
      <h1 class="text-3xl md:text-4xl font-normal text-text-primary">
        {{ greeting() }}
      </h1>
      <div
        class="flex flex-wrap justify-center gap-2"
        data-tour="vex-suggestions"
        role="group"
        [attr.aria-label]="copy.suggestions_label"
      >
        @for (suggestion of suggestions(); track suggestion.id) {
          <app-button
            variant="outline"
            size="sm"
            customClasses="rounded-full"
            (clicked)="store.sendMessage(suggestion.prompt)"
          >
            {{ suggestion.label }}
          </app-button>
        }
      </div>
      <span data-tour="vex-help">
        <app-button variant="ghost" size="sm" (clicked)="helpRequested.emit()">
          {{ copy.how_it_works }}
        </app-button>
      </span>
    </div>
  `,
})
export class VexWelcomeComponent {
  readonly store = inject(VexChatStore);
  private readonly auth = inject(AuthFacade);
  private readonly api = inject(VexApiService);
  private readonly destroyRef = inject(DestroyRef);

  /** The person asked for «¿Cómo funciona Vex?». */
  readonly helpRequested = output<void>();

  protected readonly copy = VEX_COPY.welcome;

  private readonly server_suggestions = signal<VexServerSuggestion[] | null>(null);
  readonly suggestions = computed(() =>
    resolveWelcomeSuggestions(this.server_suggestions()),
  );

  readonly greeting = computed(() => {
    const first_name = (this.auth.user()?.first_name as string | undefined)?.trim();
    return first_name ? this.copy.greeting_named(first_name) : this.copy.greeting;
  });

  constructor() {
    let destroyed = false;
    this.destroyRef.onDestroy(() => (destroyed = true));
    // Secondary signal: on failure the default questions stay on screen.
    firstValueFrom(this.api.getSuggestions())
      .then((items) => {
        if (!destroyed) this.server_suggestions.set(items);
      })
      .catch(() => undefined);
  }
}
