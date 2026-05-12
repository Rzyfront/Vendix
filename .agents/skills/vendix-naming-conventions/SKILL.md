---
name: vendix-naming-conventions
description: >
  Naming conventions for Vendix TypeScript, Angular, NestJS, Prisma, files, and routes.
  Trigger: Writing Code (Naming), creating files/classes/interfaces/enums, or reviewing naming consistency.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Writing Code (Naming)"
    - "Creating files, classes, interfaces, enums, or routes"
---

# Vendix Naming Conventions

## Purpose

Use this skill to keep names consistent with the existing Vendix codebase. Do not rename existing persisted database objects just to satisfy a convention; schema changes require the Prisma migration skills.

## TypeScript Rules

| Item | Convention | Example |
| --- | --- | --- |
| Variables and properties | `camelCase` | `userName`, `orderTotal`, `isActive` |
| Functions and methods | `camelCase` | `getUserData()`, `calculateOrderTotal()` |
| Classes | `PascalCase` | `UserService`, `ProductListComponent` |
| Interfaces and types | `PascalCase` | `ApiResponse`, `CreateUserDto` |
| Enum names | `PascalCase` | `UserRole`, `OrderStatus` |
| Enum members in TS code | follow existing enum source | Prisma generated enums may be lowercase or uppercase depending on schema |
| Constants | `SCREAMING_SNAKE_CASE` for true constants | `MAX_RETRIES`, `DEFAULT_TIMEOUT` |

Avoid forced `snake_case` in TypeScript variables unless the name mirrors database fields, external API payloads, Prisma model fields, or an existing DTO contract.

## File And Folder Rules

| Item | Convention | Example |
| --- | --- | --- |
| Files | `kebab-case` with role suffix | `user.service.ts`, `order.controller.ts` |
| Folders | `kebab-case` | `user-management/`, `product-list/` |
| Angular component selectors | `app-kebab-case` | `app-user-profile` |
| NestJS route paths | `kebab-case` | `@Controller('user-management')` |

## Prisma And Database Rules

Vendix Prisma schema mirrors the existing database naming style:

- Models are database table names in `snake_case`, e.g. `users`, `sales_orders`.
- Columns and relations that represent DB fields use `snake_case`, e.g. `organization_id`, `created_at`.
- Prisma enum names commonly use `snake_case` with `_enum`, e.g. `user_state_enum`.
- Prisma enum values follow the persisted DB values. Many are lowercase `snake_case`, while some protocol-like values are uppercase, e.g. HTTP methods.

Do not rename Prisma models, columns, or enum values without loading `vendix-prisma-schema` and `vendix-prisma-migrations`.

## Angular And NestJS Class Suffixes

| Type | Suffix |
| --- | --- |
| Angular component | `Component` |
| Angular service | `Service` |
| Angular facade | `Facade` |
| NestJS controller | `Controller` |
| NestJS service | `Service` |
| NestJS module | `Module` |
| Guard | `Guard` |
| Interceptor | `Interceptor` |
| Middleware | `Middleware` |

## Decision Rules

| Situation | Use |
| --- | --- |
| New TS variable/function | `camelCase` |
| New class/interface/type | `PascalCase` |
| New file/folder | `kebab-case` |
| New Prisma DB field | existing schema style, usually `snake_case` |
| External API uses snake_case | Preserve payload contract or map at boundary |
| Existing code in same file uses a local pattern | Follow local pattern unless the task is to refactor naming |

## Related Skills

- `vendix-prisma-schema` - Prisma naming and schema edits
- `vendix-prisma-migrations` - Safe database renames/migrations
- `vendix-frontend-component` - Angular component structure
- `vendix-backend-domain` - Backend domain structure
