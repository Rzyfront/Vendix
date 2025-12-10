# Public Domain

## Overview

This domain contains all **public-facing modules** that are accessible without authentication.

## Purpose

Public endpoints are separated from private/authenticated endpoints to:
- Provide clear architectural boundaries
- Make it easy to identify which APIs are publicly accessible
- Allow for different rate limiting, caching, and security policies
- Scale public and private APIs independently

## Structure

```
public/
├── public.module.ts           # Main aggregator module
├── domains/                   # Public domain resolution
│   ├── public-domains.controller.ts
│   ├── public-domains.module.ts
│   └── README.md
└── README.md                  # This file
```

## Current Modules

### Domains Module (`/public/domains/*`)

Provides domain resolution and hostname availability checking for frontend applications.

See [domains/README.md](./domains/README.md) for details.

## Adding New Public Modules

To add a new public module:

1. Create a new directory under `public/`
2. Implement your controller with `@Public()` decorator on endpoints
3. Create a module file
4. Import the module in `public.module.ts`

## Routing

All endpoints in this domain are prefixed with `/public/`:
- `/public/domains/resolve/:hostname`
- `/public/domains/check/:hostname`
- (future public endpoints)

## Security Considerations

- All endpoints bypass authentication via `@Public()` decorator
- Implement rate limiting for public endpoints
- Consider caching strategies for frequently accessed data
- Validate all inputs thoroughly
- Monitor for abuse and implement IP-based throttling if needed
