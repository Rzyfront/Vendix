import {
  Controller,
  Get,
  Post,
  Query,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Delete,
  Patch,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { InventoryAdjustmentsService } from './inventory-adjustments.service';
import {
  CreateAdjustmentDto,
  AdjustmentQueryDto,
} from './interfaces/inventory-adjustment.interface';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { RequirePermissions } from '../../../auth/decorators/permissions.decorator';

@ApiTags('Inventory Adjustments')
@Controller('inventory/adjustments')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class InventoryAdjustmentsController {
  constructor(
    private readonly adjustmentsService: InventoryAdjustmentsService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create inventory adjustment' })
  @ApiResponse({ status: 201, description: 'Adjustment created successfully' })
  @RequirePermissions('create:inventory-adjustment')
  async createAdjustment(@Body() createAdjustmentDto: CreateAdjustmentDto) {
    return await this.adjustmentsService.createAdjustment(createAdjustmentDto);
  }

  @Patch(':id/approve')
  @ApiOperation({ summary: 'Approve inventory adjustment' })
  @ApiResponse({ status: 200, description: 'Adjustment approved successfully' })
  @RequirePermissions('approve:inventory-adjustment')
  async approveAdjustment(
    @Param('id') id: number,
    @Body('approvedByUserId') approvedByUserId: number,
  ) {
    return await this.adjustmentsService.approveAdjustment(
      parseInt(id.toString()),
      approvedByUserId,
    );
  }

  @Get()
  @ApiOperation({ summary: 'Get inventory adjustments with filters' })
  @ApiResponse({
    status: 200,
    description: 'Adjustments retrieved successfully',
  })
  @RequirePermissions('read:inventory-adjustment')
  async getAdjustments(@Query() query: AdjustmentQueryDto) {
    return await this.adjustmentsService.getAdjustments(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get adjustment by ID' })
  @ApiResponse({
    status: 200,
    description: 'Adjustment retrieved successfully',
  })
  @RequirePermissions('read:inventory-adjustment')
  async getAdjustmentById(@Param('id') id: number) {
    return await this.adjustmentsService.getAdjustmentById(
      parseInt(id.toString()),
    );
  }

  @Get('summary/:organizationId')
  @ApiOperation({ summary: 'Get adjustment summary for organization' })
  @ApiResponse({
    status: 200,
    description: 'Adjustment summary retrieved successfully',
  })
  @RequirePermissions('read:inventory-adjustment')
  async getAdjustmentSummary(
    @Param('organizationId') organizationId: number,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return await this.adjustmentsService.getAdjustmentSummary(
      parseInt(organizationId.toString()),
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
    );
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete pending adjustment' })
  @ApiResponse({ status: 200, description: 'Adjustment deleted successfully' })
  @RequirePermissions('delete:inventory-adjustment')
  async deleteAdjustment(@Param('id') id: number) {
    await this.adjustmentsService.deleteAdjustment(parseInt(id.toString()));
  }
}
