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
    try {
      const result = await this.bankAccountsService.listForStore();
      return this.responseService.success(result, 'Cuentas bancarias obtenidas');
    } catch (error) {
      return this.responseService.error(error.message || 'Error al listar cuentas', error);
    }
  }

  @Post()
  @Permissions('store:settings:write')
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateBankAccountDto) {
    try {
      const result = await this.bankAccountsService.create(dto);
      return this.responseService.success(result, 'Cuenta bancaria creada');
    } catch (error) {
      return this.responseService.error(error.message || 'Error al crear cuenta', error);
    }
  }

  @Patch(':id')
  @Permissions('store:settings:write')
  async update(@Param('id') id: string, @Body() dto: UpdateBankAccountDto) {
    try {
      const result = await this.bankAccountsService.update(+id, dto);
      return this.responseService.success(result, 'Cuenta bancaria actualizada');
    } catch (error) {
      return this.responseService.error(error.message || 'Error al actualizar cuenta', error);
    }
  }

  @Delete(':id')
  @Permissions('store:settings:write')
  @HttpCode(HttpStatus.OK)
  async close(@Param('id') id: string) {
    try {
      const result = await this.bankAccountsService.close(+id);
      return this.responseService.success(result, 'Cuenta bancaria cerrada');
    } catch (error) {
      return this.responseService.error(error.message || 'Error al cerrar cuenta', error);
    }
  }
}
