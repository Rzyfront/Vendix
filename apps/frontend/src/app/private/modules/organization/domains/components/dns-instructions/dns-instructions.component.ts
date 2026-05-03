import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  signal,
  inject,
  DestroyRef,
  OnInit,
  model,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { IconComponent, ButtonComponent, SpinnerComponent } from '../../../../../../shared/components/index';
import { OrganizationDomainsService } from '../../services/organization-domains.service';

interface DnsInstruction {
  record_type: string;
  name: string;
  value: string;
  ttl: number;
  purpose?: string;
}

interface DnsInstructionsData {
  hostname: string;
  ownership: string;
  dns_type: 'CNAME' | 'A';
  target: string;
  instructions: DnsInstruction[];
}

@Component({
  selector: 'app-dns-instructions',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, IconComponent, ButtonComponent],
  template: `
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <h4 class="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
          <app-icon name="dns" [size]="16" />
          Configuración DNS
        </h4>
        <app-button
          variant="ghost"
          size="sm"
          [loading]="isLoading()"
          (clicked)="loadInstructions()"
        >
          <app-icon name="refresh-cw" [size]="14" slot="icon" />
          Actualizar
        </app-button>
      </div>

      @if (dnsData()) {
        <div class="space-y-3">
          <!-- DNS Type Badge -->
          <div class="flex items-center gap-2">
            <span class="px-2 py-1 text-xs font-medium rounded-full"
              [ngClass]="{
                'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400': dnsData()!.dns_type === 'CNAME',
                'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400': dnsData()!.dns_type === 'A'
              }">
              {{ dnsData()!.dns_type }} Record
            </span>
            <span class="text-xs text-[var(--color-text-secondary)]">
              @if (dnsData()!.dns_type === 'CNAME') {
                Para subdominios
              } @else {
                Para dominio raíz (apex)
              }
            </span>
          </div>

          <!-- Instructions Card -->
          <div class="bg-[var(--color-muted)]/50 rounded-lg border border-[var(--color-border)] overflow-hidden">
            <table class="w-full text-sm">
              <thead class="bg-[var(--color-muted)]">
                <tr>
                  <th class="px-3 py-2 text-left text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider">
                    Tipo
                  </th>
                  <th class="px-3 py-2 text-left text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider">
                    Nombre
                  </th>
                  <th class="px-3 py-2 text-left text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider">
                    Valor
                  </th>
                  <th class="px-3 py-2 text-left text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider">
                    TTL
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-[var(--color-border)]">
                @for (instruction of dnsData()!.instructions; track instruction.record_type + instruction.name + instruction.value) {
                  <tr>
                    <td class="px-3 py-2">
                      <span class="font-mono text-xs font-medium text-[var(--color-text-primary)]">
                        {{ instruction.record_type }}
                      </span>
                      @if (instruction.purpose) {
                        <div class="text-[10px] text-[var(--color-text-secondary)]">
                          {{ formatPurpose(instruction.purpose) }}
                        </div>
                      }
                    </td>
                    <td class="px-3 py-2">
                      <span class="font-mono text-xs text-[var(--color-text-primary)]">
                        {{ instruction.name }}
                      </span>
                    </td>
                    <td class="px-3 py-2">
                      <span class="font-mono text-xs text-[var(--color-text-primary)]">
                        {{ instruction.value }}
                      </span>
                    </td>
                    <td class="px-3 py-2">
                      <span class="text-xs text-[var(--color-text-secondary)]">
                        {{ instruction.ttl }}s
                      </span>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>

          <!-- Copy Helper -->
          <div class="flex items-center gap-2 p-2 bg-[var(--color-muted)]/30 rounded-lg">
            <app-icon name="lightbulb" [size]="14" class="text-[var(--color-text-secondary)]" />
            <span class="text-xs text-[var(--color-text-secondary)]">
              Agrega el registro DNS en tu panel de configuración de dominio
            </span>
          </div>
        </div>
      } @else if (!isLoading() && !error()) {
        <div class="text-center py-4">
          <p class="text-sm text-[var(--color-text-secondary)]">
            Selecciona un hostname para ver las instrucciones DNS
          </p>
        </div>
      }

      @if (error()) {
        <div class="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
          <p class="text-xs text-red-700 dark:text-red-300">
            {{ error() }}
          </p>
        </div>
      }
    </div>
  `,
  styles: [`
    :host {
      display: block;
    }
  `],
})
export class DnsInstructionsComponent implements OnInit {
  private domainsService = inject(OrganizationDomainsService);
  private destroyRef = inject(DestroyRef);

  readonly hostname = input<string | null>(null);
  readonly isOpen = model<boolean>(false);

  readonly isLoading = signal(false);
  readonly dnsData = signal<DnsInstructionsData | null>(null);
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    if (this.hostname()) {
      this.loadInstructions();
    }
  }

  loadInstructions(): void {
    const host = this.hostname();
    if (!host) {
      this.error.set('Hostname no proporcionado');
      return;
    }

    this.isLoading.set(true);
    this.error.set(null);

    this.domainsService.getDnsInstructions(host)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.dnsData.set(response.data);
          this.isLoading.set(false);
        },
        error: (err) => {
          this.error.set('Error cargando instrucciones DNS');
          this.isLoading.set(false);
        },
      });
  }

  formatPurpose(purpose: string): string {
    const labels: Record<string, string> = {
      ownership: 'Propiedad',
      routing: 'Routing',
      certificate: 'Certificado ACM',
    };
    return labels[purpose] || purpose;
  }
}
