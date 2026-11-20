import { Component } from '@angular/core';

import { TransferAdvancedPageComponent } from '../../../../store/inventory/transfers/quick-move/transfer-advanced-page.component';
import {
  OrgTransferAdvancedApi,
  TRANSFER_ADVANCED_API,
} from '../../../../store/inventory/transfers/advanced/transfer-advanced-api';

/**
 * Vista avanzada del movimiento de inventario en la superficie de organización.
 *
 * La pantalla es la misma que en tienda (compartida). Esta envoltura le da los
 * endpoints de organización (`/organization/inventory/transfers`) y sus bodegas
 * (D7: el scope de organización ve las bodegas de todas sus tiendas). La ruta
 * hereda el scope y el permiso del padre.
 */
@Component({
  selector: 'vendix-org-transfer-advanced-page',
  standalone: true,
  imports: [TransferAdvancedPageComponent],
  providers: [
    { provide: TRANSFER_ADVANCED_API, useExisting: OrgTransferAdvancedApi },
  ],
  template: `<app-transfer-advanced-page></app-transfer-advanced-page>`,
})
export class OrgTransferAdvancedPageComponent {}
