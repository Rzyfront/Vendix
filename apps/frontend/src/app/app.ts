import { Component, OnInit, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AppInitializerService } from './core/services/app-initializer.service';
import { CardComponent } from './shared/components/card/card.component';

// Import shared components
// Removed ButtonComponent and CardComponent (not used directly in App template)
import { SpinnerComponent } from './shared/components/spinner/spinner.component';
import { ToastContainerComponent } from './shared/components/toast/toast-container.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, CommonModule, CardComponent, SpinnerComponent, ToastContainerComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements OnInit {
  protected title = 'vendix';
  isLoading = true;
  error: string | null = null;

  private appInitializer = inject(AppInitializerService);

  ngOnInit(): void {
    // Check if app is already initialized via APP_INITIALIZER
    if (this.appInitializer.isAppInitialized()) {
      this.isLoading = false;
    } else if (this.appInitializer.hasInitializationError()) {
      // Check if there was an initialization error
      const error = this.appInitializer.getInitializationError();

      // Show user-friendly error message
      if (error?.message?.includes('Domain') && error?.message?.includes('not found')) {
        this.error = 'Store not found';
      } else {
        this.error = 'Application initialization failed';
      }
      this.isLoading = false;
    } else {
      // If not initialized and no error, show generic error
      this.error = 'Application initialization failed';
      this.isLoading = false;
    }
  }
}
