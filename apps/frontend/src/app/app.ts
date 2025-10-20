import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';
import { Observable } from 'rxjs';
import { ConfigFacade } from './core/store/config';
import { CardComponent } from './shared/components/card/card.component';
import { SpinnerComponent } from './shared/components/spinner/spinner.component';
import { ToastContainerComponent } from './shared/components/toast/toast-container.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, CommonModule, CardComponent, SpinnerComponent, ToastContainerComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  protected title = 'vendix';
  
  public readonly isLoading$: Observable<boolean>;
  public readonly error$: Observable<any>;

  private configFacade = inject(ConfigFacade);

  constructor() {
    this.isLoading$ = this.configFacade.isLoading$;
    this.error$ = this.configFacade.error$;
  }
}