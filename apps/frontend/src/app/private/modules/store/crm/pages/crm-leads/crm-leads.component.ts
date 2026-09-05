import {
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CrmService } from '../../services/crm.service';
import {
  CrmLead,
  CrmLeadStatus,
  CrmLeadsData,
} from '../../models/crm.model';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { ToastService } from '../../../../../../shared/components';

@Component({
  selector: 'app-crm-leads',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, ButtonComponent],
  templateUrl: './crm-leads.component.html',
  styleUrl: './crm-leads.component.scss',
})
export class CrmLeadsComponent {
  private readonly crmService = inject(CrmService);
  private readonly toast = inject(ToastService);

  readonly loading = signal<boolean>(false);
  readonly updatingId = signal<number | null>(null);
  readonly leads = signal<CrmLead[]>([]);
  readonly filterStatus = signal<string>('all');
  readonly searchQuery = signal<string>('');

  readonly stats = signal<{
    total: number;
    new_count: number;
    contacted_count: number;
    converted_count: number;
    conversion_rate: number;
  }>({
    total: 0,
    new_count: 0,
    contacted_count: 0,
    converted_count: 0,
    conversion_rate: 0,
  });

  readonly filteredLeads = computed(() => {
    const query = this.searchQuery().toLowerCase().trim();
    const status = this.filterStatus();
    let result = this.leads();

    if (status !== 'all') {
      result = result.filter((l) => l.status === status);
    }

    if (query) {
      result = result.filter(
        (l) =>
          l.name.toLowerCase().includes(query) ||
          (l.email && l.email.toLowerCase().includes(query)) ||
          (l.phone && l.phone.includes(query)) ||
          l.message.toLowerCase().includes(query),
      );
    }

    return result;
  });

  constructor() {
    this.loadLeads();
  }

  loadLeads(): void {
    this.loading.set(true);
    this.crmService.getLeads(this.filterStatus()).subscribe({
      next: (res) => {
        this.loading.set(false);
        if (res.data) {
          this.leads.set(res.data.leads);
          this.stats.set(res.data.stats);
        }
      },
      error: () => {
        this.loading.set(false);
        this.toast.error('No se pudieron cargar los prospectos del CRM');
      },
    });
  }

  setFilter(status: string): void {
    this.filterStatus.set(status);
    this.loadLeads();
  }

  updateStatus(lead: CrmLead, newStatus: CrmLeadStatus): void {
    if (lead.status === newStatus) return;
    this.updatingId.set(lead.id);

    this.crmService.updateLeadStatus(lead.id, newStatus).subscribe({
      next: (res) => {
        this.updatingId.set(null);
        // Actualización optimista del listado local
        this.leads.update((current) =>
          current.map((l) => (l.id === lead.id ? { ...l, status: newStatus } : l)),
        );

        // Recalcular métricas en memoria
        this.stats.update((s) => {
          let n = s.new_count;
          let c = s.contacted_count;
          let cv = s.converted_count;

          if (lead.status === 'new') n = Math.max(0, n - 1);
          else if (lead.status === 'contacted') c = Math.max(0, c - 1);
          else if (lead.status === 'converted') cv = Math.max(0, cv - 1);

          if (newStatus === 'new') n++;
          else if (newStatus === 'contacted') c++;
          else if (newStatus === 'converted') cv++;

          const total = s.total;
          const rate = total > 0 ? Math.round((cv / total) * 100) : 0;

          return {
            total,
            new_count: n,
            contacted_count: c,
            converted_count: cv,
            conversion_rate: rate,
          };
        });

        this.toast.success(`Estado de ${lead.name} actualizado a "${this.statusLabel(newStatus)}"`);
      },
      error: () => {
        this.updatingId.set(null);
        this.toast.error('No se pudo actualizar el estado del prospecto');
      },
    });
  }

  statusLabel(status: CrmLeadStatus): string {
    switch (status) {
      case 'new':
        return 'Nuevo Lead';
      case 'contacted':
        return 'Contactado';
      case 'converted':
        return 'Cliente Convertido';
      default:
        return status;
    }
  }

  openWhatsApp(lead: CrmLead): void {
    if (!lead.phone) {
      this.toast.warning('Este contacto no tiene un teléfono registrado');
      return;
    }
    const cleanPhone = lead.phone.replace(/[^\d+]/g, '');
    const message = encodeURIComponent(
      `¡Hola ${lead.name}! Te escribimos desde la tienda respecto a tu consulta en nuestra web.`,
    );
    window.open(`https://wa.me/${cleanPhone}?text=${message}`, '_blank', 'noopener,noreferrer');
  }

  openEmail(lead: CrmLead): void {
    if (!lead.email) {
      this.toast.warning('Este contacto no tiene un correo registrado');
      return;
    }
    const subject = encodeURIComponent('Respuesta a tu consulta');
    window.open(`mailto:${lead.email}?subject=${subject}`, '_blank');
  }
}
