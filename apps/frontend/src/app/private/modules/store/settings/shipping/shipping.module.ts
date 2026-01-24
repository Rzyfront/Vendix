import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Routes } from '@angular/router';
import { HttpClientModule } from '@angular/common/http';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';

import { ShippingLayoutComponent } from './shipping.component';

const routes: Routes = [
    {
        path: '',
        component: ShippingLayoutComponent,

    }
];

@NgModule({
    declarations: [],
    imports: [
        CommonModule,
        RouterModule.forChild(routes),
        HttpClientModule,
        ReactiveFormsModule,
        FormsModule,
        ShippingLayoutComponent
    ]
})
export class ShippingModule { }
