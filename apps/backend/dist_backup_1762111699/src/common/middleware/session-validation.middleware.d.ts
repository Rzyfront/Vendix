import { NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
export declare class SessionValidationMiddleware implements NestMiddleware {
    private readonly prismaService;
    constructor(prismaService: PrismaService);
    use(req: Request, res: Response, next: NextFunction): Promise<void>;
}
