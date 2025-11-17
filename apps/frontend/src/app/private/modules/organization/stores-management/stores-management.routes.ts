import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { StoresManagementComponent } from './stores-management.component';

const routes: Routes = [
  {
    path: '',
    component: StoresManagementComponent,
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class StoresManagementRoutingModule {}
