import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import {
  ModuleFlowGuard,
  RequireModuleFlow,
} from '../../../../common/guards/module-flow.guard';
import { UseGuards } from '@nestjs/common';
import { Controller, Get, Query } from '@nestjs/common';
import { AccountingReportsService } from './accounting-reports.service';
import { ResponseService } from '../../../../common/responses/response.service';
import { ReportQueryDto } from './dto/report-query.dto';
import { SubsidiaryLedgerQueryDto } from './dto/subsidiary-ledger-query.dto';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';

@Controller('store/accounting/reports')
@UseGuards(ModuleFlowGuard, PermissionsGuard)
@RequireModuleFlow('accounting')
export class AccountingReportsController {
  constructor(
    private readonly accounting_reports_service: AccountingReportsService,
    private readonly response_service: ResponseService,
  ) {}

  @Get('trial-balance')
  @Permissions('store:accounting:reports:read')
  async getTrialBalance(@Query() query_dto: ReportQueryDto) {
    const result =
      await this.accounting_reports_service.getTrialBalance(query_dto);
    return this.response_service.success(result);
  }

  @Get('balance-sheet')
  @Permissions('store:accounting:reports:read')
  async getBalanceSheet(@Query() query_dto: ReportQueryDto) {
    const result =
      await this.accounting_reports_service.getBalanceSheet(query_dto);
    return this.response_service.success(result);
  }

  @Get('income-statement')
  @Permissions('store:accounting:reports:read')
  async getIncomeStatement(@Query() query_dto: ReportQueryDto) {
    const result =
      await this.accounting_reports_service.getIncomeStatement(query_dto);
    return this.response_service.success(result);
  }

  @Get('general-ledger')
  @Permissions('store:accounting:reports:read')
  async getGeneralLedger(@Query() query_dto: ReportQueryDto) {
    const result =
      await this.accounting_reports_service.getGeneralLedger(query_dto);
    return this.response_service.success(result);
  }

  /**
   * Libro auxiliar (art. 48-55 C.Co, obligatorio para comerciantes). Un solo
   * endpoint con dos modos mutuamente excluyentes, despachados aquí según los
   * query params presentes:
   *   - ?account_code=1435                        → jerárquico padre+hijas
   *   - ?third_party_type=customer&third_party_id=N → por tercero
   */
  @Get('subsidiary-ledger')
  @Permissions('store:accounting:reports:read')
  async getSubsidiaryLedger(@Query() query_dto: SubsidiaryLedgerQueryDto) {
    const has_account_mode = !!query_dto.account_code;
    const has_third_party_mode =
      !!query_dto.third_party_type && query_dto.third_party_id != null;

    if (has_account_mode && has_third_party_mode) {
      throw new VendixHttpException(
        ErrorCodes.ACC_VALIDATE_001,
        'Provide either account_code OR third_party_type+third_party_id, not both',
      );
    }

    if (has_account_mode) {
      const result =
        await this.accounting_reports_service.getSubsidiaryLedgerByAccountRange(
          {
            account_code: query_dto.account_code!,
            date_from: query_dto.date_from,
            date_to: query_dto.date_to,
          },
        );
      return this.response_service.success(result);
    }

    if (has_third_party_mode) {
      const result =
        await this.accounting_reports_service.getSubsidiaryLedgerByThirdParty(
          {
            third_party_type: query_dto.third_party_type!,
            third_party_id: query_dto.third_party_id!,
            date_from: query_dto.date_from,
            date_to: query_dto.date_to,
          },
        );
      return this.response_service.success(result);
    }

    throw new VendixHttpException(
      ErrorCodes.ACC_VALIDATE_001,
      'Provide account_code OR both third_party_type and third_party_id',
    );
  }
}
