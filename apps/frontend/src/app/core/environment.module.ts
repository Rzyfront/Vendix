import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

// Services
import { EnvironmentSwitchService } from './services/environment-switch.service';
import { EnvironmentContextService } from './services/environment-context.service';

// Guards
import { OrganizationAdminGuard } from './guards/organization-admin.guard';
import { StoreAdminGuard } from './guards/store-admin.guard';

@NgModule({
  imports: [CommonModule],
  providers: [
    EnvironmentSwitchService,
    EnvironmentContextService,
    OrganizationAdminGuard,
    StoreAdminGuard,
  ],
})
export class EnvironmentModule {}
