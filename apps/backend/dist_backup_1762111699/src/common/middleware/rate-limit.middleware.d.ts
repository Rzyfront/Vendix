import { NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
export declare class RateLimitMiddleware implements NestMiddleware {
    private attempts;
    use(req: Request, res: Response, next: NextFunction): void;
}
export declare class LoginRateLimitMiddleware implements NestMiddleware {
    private attempts;
    use(req: Request, res: Response, next: NextFunction): void;
}
export declare class RefreshRateLimitMiddleware implements NestMiddleware {
    private attempts;
    use(req: Request, res: Response, next: NextFunction): void;
}
