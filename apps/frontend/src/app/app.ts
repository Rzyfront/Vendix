import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';
import { Observable } from 'rxjs';
import { AppConfigService } from './core/services/app-config.service';
import { CardComponent } from './shared/components/card/card.component';
import { SpinnerComponent } from './shared/components/spinner/spinner.component';
import { ToastContainerComponent } from './shared/components/toast/toast-container.component';

@Component({
  selector: 'app-root',
  standalone: true, // Ensure standalone is true
  imports: [RouterOutlet, CommonModule, CardComponent, SpinnerComponent, ToastContainerComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  protected title = 'vendix';
  
  // Expose observables directly from the service
  public readonly isLoading$: Observable<boolean>;
  public readonly error$: Observable<string | null>;

  private appConfigService = inject(AppConfigService);

  constructor() {
    this.isLoading$ = this.appConfigService.loading$;
    this.error$ = this.appConfigService.error$;
  }
}
