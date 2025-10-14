import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CardComponent } from '../../../../shared/components/card/card.component';
import { ButtonComponent } from '../../../../shared/components/button/button.component';
import { InputComponent } from '../../../../shared/components/input/input.component';

@Component({
  selector: 'app-organizations-management',
  standalone: true,
  imports: [CommonModule, FormsModule, CardComponent, ButtonComponent, InputComponent],
  template: `
    <div class="organizations-management">
      <header class="page-header">
        <h1>Gestión de Organizaciones</h1>
        <p>Administra todas las organizaciones registradas en Vendix</p>
      </header>

      <div class="management-actions">
        <div class="search-section">
          <app-input
            placeholder="Buscar organizaciones..."
            [(ngModel)]="searchTerm"
            (keyup.enter)="searchOrganizations()"
          ></app-input>
          <app-button (click)="searchOrganizations()" variant="primary">
            Buscar
          </app-button>
        </div>
        <app-button (click)="createOrganization()" variant="primary">
          + Nueva Organización
        </app-button>
      </div>

      <div class="organizations-grid">
        <app-card *ngFor="let org of filteredOrganizations" class="organization-card">
          <div class="org-header">
            <div class="org-info">
              <h3>{{ org.name }}</h3>
              <p class="org-slug">{{ org.slug }}</p>
              <span class="org-status" [class]="org.status">
                {{ org.status === 'active' ? 'Activa' : 'Inactiva' }}
              </span>
            </div>
            <div class="org-stats">
              <div class="stat">
                <span class="stat-number">{{ org.storesCount }}</span>
                <span class="stat-label">Tiendas</span>
              </div>
              <div class="stat">
                <span class="stat-number">{{ org.usersCount }}</span>
                <span class="stat-label">Usuarios</span>
              </div>
            </div>
          </div>

          <div class="org-details">
            <p class="org-description">{{ org.description }}</p>
            <div class="org-meta">
              <span>Plan: {{ org.plan }}</span>
              <span>Registro: {{ org.createdAt | date:'dd/MM/yyyy' }}</span>
            </div>
          </div>

          <div class="org-actions">
            <app-button (click)="editOrganization(org)" variant="secondary" size="sm">
              Editar
            </app-button>
            <app-button (click)="viewOrganization(org)" variant="primary" size="sm">
              Ver Detalles
            </app-button>
            <app-button
              (click)="toggleOrganizationStatus(org)"
              [variant]="org.status === 'active' ? 'danger' : 'primary'"
              size="sm"
            >
              {{ org.status === 'active' ? 'Desactivar' : 'Activar' }}
            </app-button>
          </div>
        </app-card>
      </div>

      <div *ngIf="filteredOrganizations.length === 0" class="no-results">
        <p>No se encontraron organizaciones que coincidan con tu búsqueda.</p>
      </div>

      <div class="pagination" *ngIf="totalPages > 1">
        <button 
          *ngFor="let page of getPages()" 
          (click)="goToPage(page)"
          [class.active]="currentPage === page"
          class="page-button"
        >
          {{ page }}
        </button>
      </div>
    </div>
  `,
  styleUrls: ['./organizations-management.component.scss']
})
export class OrganizationsManagementComponent implements OnInit {
  searchTerm = '';
  organizations: any[] = [];
  filteredOrganizations: any[] = [];
  currentPage = 1;
  itemsPerPage = 8;
  totalPages = 1;

  ngOnInit() {
    this.loadOrganizations();
  }

  private loadOrganizations() {
    // Simular carga de datos desde API
    setTimeout(() => {
      this.organizations = [
        {
          id: 1,
          name: 'TechCorp Solutions',
          slug: 'techcorp',
          description: 'Empresa líder en soluciones tecnológicas empresariales',
          status: 'active',
          plan: 'enterprise',
          storesCount: 5,
          usersCount: 23,
          createdAt: new Date('2024-01-15')
        },
        {
          id: 2,
          name: 'FashionStore Group',
          slug: 'fashionstore',
          description: 'Cadena de tiendas de moda y accesorios',
          status: 'active',
          plan: 'premium',
          storesCount: 12,
          usersCount: 45,
          createdAt: new Date('2024-02-20')
        },
        {
          id: 3,
          name: 'FoodMarket Inc',
          slug: 'foodmarket',
          description: 'Supermercados y tiendas de alimentación',
          status: 'inactive',
          plan: 'basic',
          storesCount: 8,
          usersCount: 18,
          createdAt: new Date('2024-03-10')
        },
        {
          id: 4,
          name: 'Electronics Hub',
          slug: 'electronics-hub',
          description: 'Distribuidor de electrónica y gadgets',
          status: 'active',
          plan: 'premium',
          storesCount: 3,
          usersCount: 12,
          createdAt: new Date('2024-04-05')
        },
        {
          id: 5,
          name: 'HomeDecor Plus',
          slug: 'homedecor',
          description: 'Tienda de decoración y muebles para el hogar',
          status: 'active',
          plan: 'basic',
          storesCount: 6,
          usersCount: 15,
          createdAt: new Date('2024-05-12')
        },
        {
          id: 6,
          name: 'SportsGear Pro',
          slug: 'sportsgear',
          description: 'Equipamiento deportivo y ropa de entrenamiento',
          status: 'inactive',
          plan: 'premium',
          storesCount: 4,
          usersCount: 10,
          createdAt: new Date('2024-06-18')
        },
        {
          id: 7,
          name: 'BookWorld Stores',
          slug: 'bookworld',
          description: 'Cadena de librerías y papelerías',
          status: 'active',
          plan: 'basic',
          storesCount: 7,
          usersCount: 22,
          createdAt: new Date('2024-07-22')
        },
        {
          id: 8,
          name: 'BeautyEssentials',
          slug: 'beautyessentials',
          description: 'Productos de belleza y cuidado personal',
          status: 'active',
          plan: 'enterprise',
          storesCount: 9,
          usersCount: 28,
          createdAt: new Date('2024-08-30')
        }
      ];
      this.filteredOrganizations = [...this.organizations];
      this.calculatePagination();
    }, 1000);
  }

  searchOrganizations() {
    if (!this.searchTerm.trim()) {
      this.filteredOrganizations = [...this.organizations];
    } else {
      const term = this.searchTerm.toLowerCase();
      this.filteredOrganizations = this.organizations.filter(org =>
        org.name.toLowerCase().includes(term) ||
        org.slug.toLowerCase().includes(term) ||
        org.description.toLowerCase().includes(term)
      );
    }
    this.currentPage = 1;
    this.calculatePagination();
  }

  calculatePagination() {
    this.totalPages = Math.ceil(this.filteredOrganizations.length / this.itemsPerPage);
  }

  getPages(): number[] {
    return Array.from({ length: this.totalPages }, (_, i) => i + 1);
  }

  goToPage(page: number) {
    this.currentPage = page;
    // En una implementación real, aquí cargaríamos los datos de la página desde la API
  }

  createOrganization() {
    console.log('Crear nueva organización');
    // Navegar al formulario de creación de organización
  }

  editOrganization(organization: any) {
    console.log('Editar organización:', organization);
    // Navegar al formulario de edición
  }

  viewOrganization(organization: any) {
    console.log('Ver detalles de organización:', organization);
    // Navegar a la vista de detalles
  }

  toggleOrganizationStatus(organization: any) {
    organization.status = organization.status === 'active' ? 'inactive' : 'active';
    console.log('Cambiar estado de organización:', organization);
    // En producción, llamar a la API para actualizar el estado
  }
}