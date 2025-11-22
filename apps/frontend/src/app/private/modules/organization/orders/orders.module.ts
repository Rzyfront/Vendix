import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { OrdersRoutingModule } from './orders.routes';
import { OrganizationOrdersService } from './services/organization-orders.service';

@NgModule({
  declarations: [],
  imports: [CommonModule, OrdersRoutingModule],
  providers: [OrganizationOrdersService],
})
export class OrdersModule {}
