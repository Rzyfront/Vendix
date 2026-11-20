import { Component } from '@angular/core';

import { TransferAdvancedPageComponent } from '../../../../store/inventory/transfers/quick-move/transfer-advanced-page.component';

/**
 * Vista avanzada del movimiento de inventario en la superficie de organización.
 *
 * La pantalla es la misma que en tienda (compartida): lo único propio de cada
 * superficie es la ruta, que aquí hereda el scope de organización y el permiso
 * del padre. Se mantiene el componente de ruta separado para que las rutas de
 * organización no importen un componente con nombre de tienda.
 */
@Component({
  selector: 'vendix-org-transfer-advanced-page',
  standalone: true,
  imports: [TransferAdvancedPageComponent],
  template: `<app-transfer-advanced-page></app-transfer-advanced-page>`,
})
export class OrgTransferAdvancedPageComponent {}
