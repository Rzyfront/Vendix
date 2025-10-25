import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import { ModalComponent } from '../../../../shared/components/modal/modal.component';
import { IconComponent } from '../../../../shared/components/icon/icon.component';

@NgModule({
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ModalComponent,
    IconComponent
  ],
  exports: [
    CommonModule,
    ReactiveFormsModule,
    ModalComponent,
    IconComponent
  ]
})
export class SharedModule { }
