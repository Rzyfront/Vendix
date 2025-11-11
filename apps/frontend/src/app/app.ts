import { Component, inject, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';
import { Observable } from 'rxjs';
import { ConfigFacade } from './core/store/config';
import { RouteManagerService } from './core/services/route-manager.service';
import { CardComponent } from './shared/components/card/card.component';
import { SpinnerComponent } from './shared/components/spinner/spinner.component';
import { ToastContainerComponent } from './shared/components/toast/toast-container.component';
import { Chart, registerables } from 'chart.js';
import { firstValueFrom } from 'rxjs';

// Register Chart.js components globally
Chart.register(...registerables);

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    RouterOutlet,
    CommonModule,
    CardComponent,
    SpinnerComponent,
    ToastContainerComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit {
  protected title = 'vendix';

  public readonly isLoading$: Observable<boolean>;
  public readonly error$: Observable<any>;

  private configFacade = inject(ConfigFacade);
  private routeManager = inject(RouteManagerService);

  constructor() {
    this.isLoading$ = this.configFacade.isLoading$;
    this.error$ = this.configFacade.error$;
  }

  async ngOnInit() {
    try {
      // Inicialización segura después de que todos los servicios estén disponibles
      await firstValueFrom(this.routeManager.routesConfigured$);
      console.log('[App] Application initialized successfully');
    } catch (error) {
      console.error('[App] Error during initialization:', error);
    }
  }
}
