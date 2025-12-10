import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';

@Component({
  selector: 'app-customer-details',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './customer-details.component.html',
  styleUrls: ['./customer-details.component.css'],
})
export class CustomerDetailsComponent implements OnInit, OnDestroy {
  customerId: string | null = null;
  loading = false;

  private destroy$ = new Subject<void>();

  constructor(
    private route: ActivatedRoute,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntil(this.destroy$)).subscribe((params) => {
      this.customerId = params.get('id');
      if (this.customerId) {
        this.loadCustomerDetails(+this.customerId);
      }
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // 🆕 MÉTODOS PLACEHOLDER PARA FUTURO
  loadCustomerDetails(id: number): void {
    // TODO: Implementar carga de detalles desde servicio
    console.log('Cargando detalles del cliente:', id);
  }

  goBack(): void {
    // TODO: Implementar navegación hacia atrás
    this.router.navigate(['../'], { relativeTo: this.route });
  }

  editCustomer(): void {
    // TODO: Implementar edición de cliente
    console.log('Editar cliente:', this.customerId);
  }
}
