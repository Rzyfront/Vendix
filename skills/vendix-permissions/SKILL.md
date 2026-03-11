# Vendix Permissions System

## General Description

The Vendix permissions system is a granular RBAC (Role-Based Access Control) system that protects API endpoints using the NestJS `@Permissions()` decorator. Permissions are defined both in code (controllers) and in the database (seed), enabling full auditing and dynamic management.

**Why is it important to keep it synchronized?**
- Endpoints without correct permissions can be inaccessible or expose unauthorized functionality
- Obsolete permissions in the seed consume memory and confuse developers
- Inconsistency between code and database causes production errors

## Permission Format

### Naming Patterns

Permissions follow these patterns:

1. **Standard format**: `domain:resource:action`
   - Example: `store:products:create`
   - Example: `organization:users:update`

2. **With subresource**: `domain:resource:subresource:action`
   - Example: `store:products:variants:create`
   - Example: `organization:roles:permissions:read`

3. **Alternative format**: `domain.resource.action`
   - Example: `auth.login`
   - Example: `audit.logs`
   - Example: `domains.create`

### Permission Structure in the Seed

```typescript
{
  name: 'domain:resource:action',
  description: 'Clear description in Spanish',
  path: '/api/full/route',
  method: 'METHOD',  // GET, POST, PATCH, PUT, DELETE
},
```

### Standard Actions

- `create` - POST to create resources
- `read` - GET to list/view resources
- `update` - PATCH/PUT to update
- `delete` - DELETE to remove
- `stats` - GET for statistics
- `search` - GET for specific searches
- `admin_delete` - Hard DELETE (admin only)

## How to Add New Permissions

### Step 1: Add `@Permissions()` in the Controller

```typescript
@Controller('store/products')
@UseGuards(PermissionsGuard)
export class ProductsController {
  @Post()
  @Permissions('store:products:create')
  async create(@Body() createProductDto: CreateProductDto) {
    // implementation
  }

  @Get()
  @Permissions('store:products:read')
  async findAll(@Query() query: ProductQueryDto) {
    // implementation
  }
}
```

### Step 2: Add the Permission to the Seed

Open `/home/rzyfront/Vendix/apps/backend/prisma/seeds/permissions-roles.seed.ts` and add in the correct position (maintaining alphabetical order by domain):

```typescript
const permissions = [
  // ... other permissions ...

  // Products
  {
    name: 'store:products:create',
    description: 'Create product',
    path: '/api/store/products',
    method: 'POST',
  },
  {
    name: 'store:products:read',
    description: 'Read products',
    path: '/api/store/products',
    method: 'GET',
  },
  // add new permission here in alphabetical order
];
```

### Step 3: Run the Seed

```bash
cd /home/rzyfront/Vendix/apps/backend
npx ts-node prisma/seeds/permissions-roles.seed.ts
```

### Complete Step-by-Step Example

**Scenario**: Add permission to export products to CSV

1. **In the controller** (`store/products/products.controller.ts`):
```typescript
@Get('export/csv')
@Permissions('store:products:export:csv')
async exportToCsv(@Query() query: ProductQueryDto) {
  return this.productsService.exportToCsv(query);
}
```

2. **In the seed** (`prisma/seeds/permissions-roles.seed.ts`):
```typescript
// Add after store:products:read and before store:products:update
{
  name: 'store:products:export:csv',
  description: 'Export products to CSV',
  path: '/api/store/products/export/csv',
  method: 'GET',
},
```

3. **Run seed**:
```bash
npx ts-node prisma/seeds/permissions-roles.seed.ts
```

## How to Edit Existing Permissions

### Change Description

```typescript
// Before
{
  name: 'store:products:read',
  description: 'Read products',
  path: '/api/store/products',
  method: 'GET',
},

// After
{
  name: 'store:products:read',
  description: 'Read store products (including variants)',
  path: '/api/store/products',
  method: 'GET',
},
```

### Fix Path or Method

**Important**: If you change the route in the controller, you must update the seed as well.

```typescript
// Controller changed from /store/products to /api/store/products
{
  name: 'store:products:read',
  description: 'Read products',
  path: '/api/store/products',  // updated
  method: 'GET',
},
```

## How to Remove Obsolete Permissions

### Step 1: Verify They Are Not Used in Controllers

```bash
grep -r "@Permissions('store:products:old')" /home/rzyfront/Vendix/apps/backend/src/domains --include="*.controller.ts"
```

If there are no results, the permission is not in use and can be removed.

### Step 2: Remove from the Seed

Simply remove the permission object from the array in `prisma/seeds/permissions-roles.seed.ts`.

### Step 3: Run the Seed

```bash
npx ts-node prisma/seeds/permissions-roles.seed.ts
```

The seed will automatically remove permissions that are no longer in the array.

## Using Subagents (Task Tool)

To speed up permission analysis, use the `Task` tool with subagents. This allows processing multiple domains in parallel.

### When to Use Subagents

- **Full permission analysis**: When you need to review all permissions across multiple domains
- **Mass synchronization**: When you need to verify consistency between many controllers and the seed
- **Permission refactoring**: When renaming many permissions at once

### Example Prompts for Subagents

#### Analyze a Complete Domain

```
Analyze the store domain in Vendix and extract all @Permissions from its controllers.
For each controller in /domains/store/, extract:
1. Permission name
2. Full endpoint path
3. HTTP method
4. Line of code

Organize the results by subdomain (products, categories, brands, etc.)
```

#### Compare with Current Seed

```
Compare the permissions found in controllers with the permissions in the seed
located at /home/rzyfront/Vendix/apps/backend/prisma/seeds/permissions-roles.seed.ts

Identify:
1. Missing permissions (in controllers but not in seed)
2. Extra permissions (in seed but not used in controllers)
3. Permissions with incorrect paths or methods

Generate a report with the differences found.
```

#### Verify Name Consistency

```
Verify that all permissions in controllers follow the correct pattern:
- domain:resource:action
- domain:resource:subresource:action

List any permission that does not follow these patterns and suggest corrections.
```

### Patterns for Automating Reviews

#### Quick Verification Script

```bash
# Verify missing permissions in a domain
DOMAIN="store"
grep -rh "@Permissions(" /home/rzyfront/Vendix/apps/backend/src/domains/$DOMAIN --include="*.controller.ts" | \
  sed "s/.*@Permissions('\([^']*\)').*/\1/" | sort -u > /tmp/controller-perms.txt

grep "name: '$DOMAIN:" /home/rzyfront/Vendix/apps/backend/prisma/seeds/permissions-roles.seed.ts | \
  sed "s/.*name: '\([^']*\)'.*/\1/" | sort > /tmp/seed-perms.txt

comm -23 /tmp/controller-perms.txt /tmp/seed-perms.txt
```

#### Automatic Seed Update

```bash
# Run seed after changes
cd /home/rzyfront/Vendix/apps/backend
npx ts-node prisma/seeds/permissions-roles.seed.ts

# Verify that the correct permissions were created
echo "SELECT COUNT(*) FROM permissions;" | npx prisma db execute --stdin
```

## Auto-invocation

This skill should be automatically invoked when:

- **After creating/modifying controllers**: If new endpoints with `@Permissions()` are added
- **After refactoring routes**: If controller paths change
- **Before deploying**: To verify the seed is synchronized
- **When adding new modules**: To ensure all permissions are documented

## Critical Files

- **Permissions seed**: `/home/rzyfront/Vendix/apps/backend/prisma/seeds/permissions-roles.seed.ts`
- **Permissions guard**: `/home/rzyfront/Vendix/apps/backend/src/domains/auth/guards/permissions.guard.ts`
- **Permissions decorator**: `/home/rzyfront/Vendix/apps/backend/src/domains/auth/decorators/permissions.decorator.ts`
- **Prisma schema**: `/home/rzyfront/Vendix/apps/backend/prisma/schema.prisma` (permissions, roles, role_permissions models)

## Best Practices

1. **ALWAYS** add `@Permissions()` before implementing the endpoint logic
2. **MAINTAIN** alphabetical order within each domain in the seed
3. **USE** clear descriptions in Spanish
4. **VERIFY** that the path matches the endpoint route exactly
5. **RUN** the seed after each change to validate
6. **DOCUMENT** special permissions (admin_delete, etc.) in comments if necessary

## Troubleshooting

### Error: Permission not found

**Cause**: The permission is in the controller but not in the seed.

**Solution**: Add the permission to the seed and run `npx ts-node prisma/seeds/permissions-roles.seed.ts`.

### Error: 403 Forbidden on endpoint

**Cause**: The user does not have the permission assigned through their role.

**Solution**:
1. Verify the permission exists: `SELECT * FROM permissions WHERE name = 'permission';`
2. Verify the role has the permission: `SELECT * FROM role_permissions WHERE permission_id = X;`
3. If not, run the permissions seed or assign manually.

### Duplicate Permissions

**Cause**: Two permissions with the same name in the seed.

**Solution**: Permissions have `@unique` in the schema. The seed uses `upsert` which updates if it already exists. Verify there are no duplicates in the array.

---

**Last updated**: 2026-01-27
**Maintainer**: Vendix Team
**System version**: 1.0
