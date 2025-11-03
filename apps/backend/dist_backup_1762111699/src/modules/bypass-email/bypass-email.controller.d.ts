import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { ResponseService } from '../../common/responses/response.service';
export declare class BypassEmailController {
    private readonly prisma;
    private readonly configService;
    private readonly responseService;
    constructor(prisma: PrismaService, configService: ConfigService, responseService: ResponseService);
    verifyEmail(body: {
        user_id: number;
    }): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
}
