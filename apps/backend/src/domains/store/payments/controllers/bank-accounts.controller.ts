import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

import { BankAccountsService } from '../services/bank-accounts.service';
import { ResponseService } from '../../../../common/responses/response.service';
import {
  CreateBankAccountDto,
  UpdateBankAccountDto,
} from '../dto/bank-account.dto';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';

/**
 * QUI-728 — proyección/CRUD de `bank_accounts` para transferencia.
 *
 * Vive en el MÓDULO DE PAYMENTS (no en bank-reconciliation / accounting, que es
 * territorio de E.2). Solo expone la proyección mínima
 * `{ id, name, bank_name, account_number }`. Permisos: lectura
 * `store:settings:read`; escrituras `store:settings:write` (el cajero solo
 * tiene `read`, así que solo el admin configura cuentas).
 *
 * Los handlers NO envuelven el servicio en try/catch: `responseService.error()`
 * arma el body pero NO cambia el status HTTP, así que un `return` de error
 * salía como 2xx (201 en el `create`) con `success:false` y el `catchError` del
 * frontend nunca disparaba — el editor de settings guardaba la cuenta sin `id`
 * en silencio. Se deja subir la excepción al filtro global, que sí traduce el
 * status y limpia el error crudo de Prisma.
 */
@ApiTags('Store Bank Accounts')
@Controller('store/payments/bank-accounts')
@ApiBearerAuth()
@UseGuards(PermissionsGuard)
export class BankAccountsController {
  constructor(
    private readonly bankAccountsService: BankAccountsService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('store:settings:read')
  async list() {
    const result = await this.bankAccountsService.listForStore();
    return this.responseService.success(result, 'Cuentas bancarias obtenidas');
  }

  @Post()
  @Permissions('store:settings:write')
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateBankAccountDto) {
    const result = await this.bankAccountsService.create(dto);
    return this.responseService.success(result, 'Cuenta bancaria creada');
  }

  @Patch(':id')
  @Permissions('store:settings:write')
  async update(@Param('id') id: string, @Body() dto: UpdateBankAccountDto) {
    const result = await this.bankAccountsService.update(+id, dto);
    return this.responseService.success(result, 'Cuenta bancaria actualizada');
  }

  @Delete(':id')
  @Permissions('store:settings:write')
  @HttpCode(HttpStatus.OK)
  async close(@Param('id') id: string) {
    const result = await this.bankAccountsService.close(+id);
    return this.responseService.success(result, 'Cuenta bancaria cerrada');
  }
}
