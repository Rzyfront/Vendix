import { Controller, Get, Post, Request, Body, Param, ParseIntPipe, BadRequestException } from '@nestjs/common';
import { EcommerceLegalService } from './ecommerce-legal.service';
import { Public } from '../../auth/decorators/public.decorator';
import { ResponseService } from '../../../common/responses/response.service';

@Controller('ecommerce/legal')
export class EcommerceLegalController {
    constructor(
        private readonly legalService: EcommerceLegalService,
        private readonly responseService: ResponseService,
    ) { }

    @Public()
    @Get('pending')
    async getPending(@Request() req) {
        const userId = req.user?.id;
        const data = await this.legalService.getPendingTermsForCustomer(userId);
        return this.responseService.success(data);
    }

    @Post(':documentId/accept')
    async accept(
        @Request() req,
        @Param('documentId', ParseIntPipe) documentId: number,
        @Body() body: any,
    ) {
        const userId = req.user?.id;
        if (!userId) {
            throw new BadRequestException('User identification required for acceptance');
        }

        const metadata = {
            ip: body.ip || req.ip || 'unknown',
            userAgent: body.userAgent || req.headers['user-agent'] || 'unknown',
            context: 'ecommerce' as const,
        };

        const data = await this.legalService.acceptDocument(userId, documentId, metadata);
        return this.responseService.success(data);
    }
}
