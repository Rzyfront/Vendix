"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RefreshRateLimitMiddleware = exports.LoginRateLimitMiddleware = exports.RateLimitMiddleware = void 0;
const common_1 = require("@nestjs/common");
let RateLimitMiddleware = class RateLimitMiddleware {
    constructor() {
        this.attempts = new Map();
    }
    use(req, res, next) {
        const key = req.ip || req.connection.remoteAddress || 'unknown';
        const now = Date.now();
        const windowMs = 15 * 60 * 1000;
        const maxAttempts = 10;
        const record = this.attempts.get(key);
        if (!record || now > record.resetTime) {
            this.attempts.set(key, { count: 1, resetTime: now + windowMs });
            next();
        }
        else if (record.count < maxAttempts) {
            record.count++;
            next();
        }
        else {
            res.status(429).json({
                statusCode: 429,
                message: 'Too many requests from this IP, please try again later.',
                error: 'Too Many Requests',
                retryAfter: Math.ceil((record.resetTime - now) / 1000),
            });
        }
    }
};
exports.RateLimitMiddleware = RateLimitMiddleware;
exports.RateLimitMiddleware = RateLimitMiddleware = __decorate([
    (0, common_1.Injectable)()
], RateLimitMiddleware);
let LoginRateLimitMiddleware = class LoginRateLimitMiddleware {
    constructor() {
        this.attempts = new Map();
    }
    use(req, res, next) {
        const key = req.ip || req.connection.remoteAddress || 'unknown';
        const now = Date.now();
        const windowMs = 15 * 60 * 1000;
        const maxAttempts = 10;
        const record = this.attempts.get(key);
        if (!record || now > record.resetTime) {
            this.attempts.set(key, { count: 1, resetTime: now + windowMs });
            next();
        }
        else if (record.count < maxAttempts) {
            record.count++;
            next();
        }
        else {
            res.status(429).json({
                statusCode: 429,
                message: 'Too many login attempts from this IP, please try again later.',
                error: 'Too Many Login Attempts',
                retryAfter: Math.ceil((record.resetTime - now) / 1000),
            });
        }
    }
};
exports.LoginRateLimitMiddleware = LoginRateLimitMiddleware;
exports.LoginRateLimitMiddleware = LoginRateLimitMiddleware = __decorate([
    (0, common_1.Injectable)()
], LoginRateLimitMiddleware);
let RefreshRateLimitMiddleware = class RefreshRateLimitMiddleware {
    constructor() {
        this.attempts = new Map();
    }
    use(req, res, next) {
        const key = req.ip || req.connection.remoteAddress || 'unknown';
        const now = Date.now();
        const windowMs = 5 * 60 * 1000;
        const maxAttempts = 10;
        const record = this.attempts.get(key);
        if (!record || now > record.resetTime) {
            this.attempts.set(key, { count: 1, resetTime: now + windowMs });
            next();
        }
        else if (record.count < maxAttempts) {
            record.count++;
            next();
        }
        else {
            res.status(429).json({
                statusCode: 429,
                message: 'Too many refresh attempts from this IP, please try again later.',
                error: 'Too Many Refresh Attempts',
                retryAfter: Math.ceil((record.resetTime - now) / 1000),
            });
        }
    }
};
exports.RefreshRateLimitMiddleware = RefreshRateLimitMiddleware;
exports.RefreshRateLimitMiddleware = RefreshRateLimitMiddleware = __decorate([
    (0, common_1.Injectable)()
], RefreshRateLimitMiddleware);
//# sourceMappingURL=rate-limit.middleware.js.map