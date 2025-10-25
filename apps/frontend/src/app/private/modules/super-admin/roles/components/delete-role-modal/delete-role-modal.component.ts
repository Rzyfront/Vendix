import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RolesService } from '../../services/roles.service';
import { ModalComponent, IconComponent } from '../../../../../../shared/components/index';

@Component({
  selector: 'app-delete-role-modal',
  standalone: true,
  imports: [CommonModule, ModalComponent, IconComponent],
  templateUrl: './delete-role-modal.component.html',
})
export class DeleteRoleModalComponent {
  @Input() role: any;
  @Output() close = new EventEmitter<void>();
  @Output() roleDeleted = new EventEmitter<void>();

  constructor(private rolesService: RolesService) { }

  deleteRole(): void {
    this.rolesService.deleteRole(this.role.id).subscribe(() => {
      this.roleDeleted.emit();
      this.close.emit();
    });
  }
}
