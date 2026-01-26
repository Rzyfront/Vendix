import {
    Controller,
    Get,
    Post,
    Put,
    Delete,
    Body,
    Param,
    ParseIntPipe,
    UseGuards,
    Query,
} from '@nestjs/common';
import { ShippingService } from './shipping.service';
import { ShippingCalculatorService } from './shipping-calculator.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentStore } from '../../../common/decorators/current-store.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { RequestContextService } from '../../../common/context/request-context.service';
import { CalculateShippingDto } from './dto/shipping_calc.dto';
import {
    CreateShippingMethodDto,
    UpdateShippingMethodDto,
    CreateShippingZoneDto,
    UpdateShippingZoneDto,
    CreateShippingRateDto,
    UpdateShippingRateDto,
} from './dto/shipping.dto';

@Controller('shipping')
@UseGuards(JwtAuthGuard)
export class ShippingController {
    constructor(
        private readonly shippingService: ShippingService,
        private readonly calculatorService: ShippingCalculatorService
    ) { }

    // --- METHODS ---
    @Get('methods')
    async getMethods(@CurrentStore() storeId: number) {
        return this.shippingService.getMethods(storeId);
    }

    @Post('methods')
    async createMethod(
        @CurrentStore() storeId: number,
        @Body() dto: CreateShippingMethodDto,
    ) {
        return this.shippingService.createMethod(storeId, dto);
    }

    @Put('methods/:id')
    async updateMethod(
        @CurrentStore() storeId: number,
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: UpdateShippingMethodDto,
    ) {
        return this.shippingService.updateMethod(storeId, id, dto);
    }

    @Delete('methods/:id')
    async deleteMethod(
        @CurrentStore() storeId: number,
        @Param('id', ParseIntPipe) id: number,
    ) {
        return this.shippingService.deleteMethod(storeId, id);
    }

    // --- ZONES ---
    @Get('zones')
    async getZones(@CurrentStore() storeId: number) {
        return this.shippingService.getZones(storeId);
    }

    @Post('zones')
    async createZone(
        @CurrentStore() storeId: number,
        @Body() dto: CreateShippingZoneDto,
    ) {
        return this.shippingService.createZone(storeId, dto);
    }

    @Put('zones/:id')
    async updateZone(
        @CurrentStore() storeId: number,
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: UpdateShippingZoneDto,
    ) {
        return this.shippingService.updateZone(storeId, id, dto);
    }

    @Delete('zones/:id')
    async deleteZone(
        @CurrentStore() storeId: number,
        @Param('id', ParseIntPipe) id: number,
    ) {
        return this.shippingService.deleteZone(storeId, id);
    }

    // --- RATES ---
    @Get('zones/:zoneId/rates')
    async getRates(
        @CurrentStore() storeId: number,
        @Param('zoneId', ParseIntPipe) zoneId: number,
    ) {
        return this.shippingService.getRates(storeId, zoneId);
    }

    @Post('rates')
    async createRate(
        @CurrentStore() storeId: number,
        @Body() dto: CreateShippingRateDto,
    ) {
        return this.shippingService.createRate(storeId, dto);
    }

    @Put('rates/:id')
    async updateRate(
        @CurrentStore() storeId: number,
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: UpdateShippingRateDto
    ) {
        return this.shippingService.updateRate(storeId, id, dto);
    }

    @Delete('rates/:id')
    async deleteRate(
        @CurrentStore() storeId: number,
        @Param('id', ParseIntPipe) id: number
    ) {
        return this.shippingService.deleteRate(storeId, id);
    }

    // --- CALCULATOR ---
    @Public()
    @Post('calculate')
    async calculateAndGetRates(
        @Body() dto: CalculateShippingDto,
        @Query('store_id', ParseIntPipe) storeId: number
    ) {
        // Manually set store context for public endpoint
        RequestContextService.setDomainContext(storeId);
        return this.calculatorService.calculateRates(storeId, dto.items, dto.address);
    }
}
