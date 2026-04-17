import { NgModule } from '@angular/core';

// Services
import { EnvironmentSwitchService } from './services/environment-switch.service';
import { EnvironmentContextService } from './services/environment-context.service';

// Guards
import { OrganizationAdminGuard } from './guards/organization-admin.guard';
import { StoreAdminGuard } from './guards/store-admin.guard';

@NgModule({
  imports: [],
  providers: [
    EnvironmentSwitchService,
    EnvironmentContextService,
    OrganizationAdminGuard,
    StoreAdminGuard,
  ],
})
export class EnvironmentModule {}
