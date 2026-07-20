import {
  Component,
  computed,
  inject,
  input,
  OnInit,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { map } from 'rxjs';
import { environment } from '../../../../../../../environments/environment';
import {
  CardComponent,
  EmptyStateComponent,
  IconComponent,
  SpinnerComponent,
} from '../../../../../../shared/components';

export interface BookingProvider {
  id: number;
  display_name: string;
  avatar_url?: string | null;
  bio?: string | null;
  employee?: { id: number; first_name: string; last_name: string };
}

/**
 * ProviderSelectorComponent
 *
 * Step 1.5 del flujo ecommerce de reservas. Muestra una grid de cards con
 * los profesionales que ofrecen el servicio. El cliente toca una card
 * para seleccionarla antes de ver el calendario y los slots.
 *
 * Mobile-first: grid 1 col en <768px, 2 cols en ≥768px, 3 cols en ≥1024px.
 * Radio-card pattern (regla skill `vendix-ui-ux`): selected → borde primary
 * + shadow ring.
 */
@Component({
  selector: 'app-provider-selector',
  standalone: true,
  imports: [
    CommonModule,
    CardComponent,
    EmptyStateComponent,
    IconComponent,
    SpinnerComponent,
  ],
  templateUrl: './provider-selector.component.html',
  styleUrls: ['./provider-selector.component.scss'],
})
export class ProviderSelectorComponent implements OnInit {
  private readonly http = inject(HttpClient);

  readonly productId = input.required<number>();
  readonly preselectedProviderId = input<number | null>(null);

  readonly providerSelected = output<BookingProvider>();

  readonly providers = signal<BookingProvider[]>([]);
  readonly loading = signal(true);
  readonly errorMsg = signal<string | null>(null);
  readonly selectedId = signal<number | null>(null);

  readonly hasProviders = computed(() => this.providers().length > 0);

  ngOnInit(): void {
    this.selectedId.set(this.preselectedProviderId());
    this.fetchProviders();
  }

  selectProvider(p: BookingProvider): void {
    this.selectedId.set(p.id);
    this.providerSelected.emit(p);
  }

  /** Initials for the avatar fallback when no image URL is set. */
  initials(p: BookingProvider): string {
    const name = (p.display_name || '').trim();
    if (!name) return '?';
    const parts = name.split(/\s+/).slice(0, 2);
    return parts.map((s) => s.charAt(0).toUpperCase()).join('');
  }

  private fetchProviders(): void {
    this.loading.set(true);
    this.errorMsg.set(null);
    this.http
      .get<any>(`${environment.apiUrl}/ecommerce/reservations/providers/${this.productId()}`)
      .pipe(map((r) => r.data || r || []))
      .subscribe({
        next: (list: BookingProvider[]) => {
          this.providers.set(list);
          this.loading.set(false);
        },
        error: () => {
          this.providers.set([]);
          this.loading.set(false);
          this.errorMsg.set('No pudimos cargar los profesionales. Intenta de nuevo.');
        },
      });
  }
}