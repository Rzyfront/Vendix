import { Routes } from '@angular/router';
import { SettingsComponent } from './settings.component';
import { GeneralSettingsComponent } from './general/general-settings.component';
import { PaymentsSettingsComponent } from './payments/payments-settings.component';
import { AppearanceSettingsComponent } from './appearance/appearance-settings.component';
import { SecuritySettingsComponent } from './security/security-settings.component';

export const SETTINGS_ROUTES: Routes = [
  {
    path: '',
    component: SettingsComponent,
    children: [
      {
        path: '',
        redirectTo: 'general',
        pathMatch: 'full',
      },
      {
        path: 'general',
        component: GeneralSettingsComponent,
      },
      {
        path: 'payments',
        component: PaymentsSettingsComponent,
      },
      {
        path: 'appearance',
        component: AppearanceSettingsComponent,
      },
      {
        path: 'security',
        component: SecuritySettingsComponent,
      },
    ],
  },
];
