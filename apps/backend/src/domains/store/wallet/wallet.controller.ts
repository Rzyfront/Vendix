import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';
import { WalletService } from './wallet.service';
import { WalletQueryDto } from './dto/wallet-query.dto';
import { TopUpWalletDto } from './dto/top-up-wallet.dto';
import { AdjustWalletDto } from './dto/adjust-wallet.dto';

@ApiTags('Wallets')
@Controller('store/wallets')
@UseGuards(RolesGuard, PermissionsGuard)
export class WalletController {
  constructor(
    private readonly walletService: WalletService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('store:wallets:read')
  async findAll(@Query() query: WalletQueryDto) {
    const result = await this.walletService.findAll(query);
    return this.responseService.success(result);
  }

  @Get(':customerId')
  @Permissions('store:wallets:read')
  async getBalance(@Param('customerId', ParseIntPipe) customerId: number) {
    const result = await this.walletService.getBalance(customerId);
    return this.responseService.success(result);
  }

  @Get(':customerId/history')
  @Permissions('store:wallets:read')
  async getHistory(
    @Param('customerId', ParseIntPipe) customerId: number,
    @Query() query: WalletQueryDto,
  ) {
    const result = await this.walletService.getHistory(customerId, query);
    return this.responseService.success(result);
  }

  @Post(':customerId/topup')
  @Permissions('store:wallets:topup')
  async topUp(
    @Param('customerId', ParseIntPipe) customerId: number,
    @Body() dto: TopUpWalletDto,
    @Req() req: any,
  ) {
    const result = await this.walletService.topUp(customerId, dto, req.user.id);
    return this.responseService.success(result);
  }

  @Post(':customerId/adjust')
  @Permissions('store:wallets:adjust')
  async adjust(
    @Param('customerId', ParseIntPipe) customerId: number,
    @Body() dto: AdjustWalletDto,
    @Req() req: any,
  ) {
    const result = await this.walletService.adjust(
      customerId,
      dto,
      req.user.id,
    );
    return this.responseService.success(result);
  }
}
