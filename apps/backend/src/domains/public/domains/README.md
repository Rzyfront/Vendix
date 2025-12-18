# Public Domains Module

## Overview

This module provides **public endpoints** for domain resolution that are accessible without authentication.

## Endpoints

### `GET /public/domains/resolve/:hostname`

Resolves the configuration for a specific domain/hostname.

**Parameters:**
- `hostname` (path) - The hostname to resolve (e.g., "tienda.vendix.com")
- `subdomain` (query, optional) - Additional subdomain
- `x-forwarded-host` (header, optional) - Forwarded host from proxy/load balancer

**Response:**
```json
{
  "success": true,
  "message": "Domain resolved successfully",
  "data": {
    "id": 1,
    "hostname": "tienda.vendix.com",
    "organization_id": 1,
    "store_id": 5,
    "config": {},
    "domain_type": "store_domain",
    "status": "active",
    "ssl_status": "issued"
  }
}
```

### `GET /public/domains/check/:hostname`

Checks if a hostname is available for registration.

**Parameters:**
- `hostname` (path) - The hostname to check

**Response:**
```json
{
  "success": true,
  "message": "Hostname availability checked successfully",
  "data": {
    "available": true
  }
}
```

## Usage

These endpoints are designed to be called by the frontend application to:
1. Resolve domain configuration when a user visits the site
2. Validate hostname availability during domain registration

## Implementation Notes

- All endpoints use the `@Public()` decorator to bypass authentication
- Domain resolution logic is delegated to `DomainsService` from the organization module
- Responses use the standard `ResponseService` for consistency
