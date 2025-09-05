# Roles and Permissions Management System

## Overview

The Vendix platform includes a comprehensive role and permission management system that allows administrators to control access and permissions dynamically. This system provides granular control over what users can do within the platform.

## Features

- ✅ **CRUD Operations for Roles**: Create, read, update, and delete roles
- ✅ **Dynamic Permission Assignment**: Assign and remove permissions from roles
- ✅ **User Role Management**: Assign and remove roles from users
- ✅ **Permission Validation**: Dynamic permission checking for API endpoints
- ✅ **Audit Logging**: All role and permission changes are logged
- ✅ **Multi-tenant Support**: Roles and permissions work within organization boundaries

## API Endpoints

### Roles Management

#### Create Role
```http
POST /api/roles
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "manager",
  "description": "Store manager with limited admin access",
  "is_system_role": false
}
```

#### Get All Roles
```http
GET /api/roles
Authorization: Bearer <token>
```

#### Get Role by ID
```http
GET /api/roles/:id
Authorization: Bearer <token>
```

#### Update Role
```http
PATCH /api/roles/:id
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "senior_manager",
  "description": "Senior store manager"
}
```

#### Delete Role
```http
DELETE /api/roles/:id
Authorization: Bearer <token>
```

### Permission Management

#### Assign Permissions to Role
```http
POST /api/roles/:id/permissions
Authorization: Bearer <token>
Content-Type: application/json

{
  "permissionIds": [1, 2, 3]
}
```

#### Remove Permissions from Role
```http
DELETE /api/roles/:id/permissions
Authorization: Bearer <token>
Content-Type: application/json

{
  "permissionIds": [2]
}
```

### User Role Management

#### Assign Role to User
```http
POST /api/roles/assign-to-user
Authorization: Bearer <token>
Content-Type: application/json

{
  "userId": 123,
  "roleId": 456
}
```

#### Remove Role from User
```http
POST /api/roles/remove-from-user
Authorization: Bearer <token>
Content-Type: application/json

{
  "userId": 123,
  "roleId": 456
}
```

### User Permissions and Roles

#### Get User Permissions
```http
GET /api/roles/user/:userId/permissions
Authorization: Bearer <token>
```

#### Get User Roles
```http
GET /api/roles/user/:userId/roles
Authorization: Bearer <token>
```

## Permission System

### Permission Structure
Each permission consists of:
- **Resource**: The entity being accessed (users, products, orders, etc.)
- **Action**: The operation being performed (create, read, update, delete)
- **Method**: HTTP method (GET, POST, PUT, PATCH, DELETE)

### Available Permissions
The system supports permissions for the following resources:
- Users
- Organizations
- Stores
- Products
- Orders
- Payments
- Categories
- Brands
- Taxes
- Inventory
- Refunds

## User Roles

### System Roles
- **ADMIN**: Full system access
- **MANAGER**: Management access with some restrictions
- **STAFF**: Limited operational access
- **CLIENT**: Customer access
- **OWNER**: Organization owner access

### Custom Roles
Administrators can create custom roles with specific permission combinations.

## Security Features

### Role-Based Access Control (RBAC)
- Users are assigned roles
- Roles contain permissions
- Permissions control access to resources

### Audit Logging
All role and permission changes are logged with:
- User who made the change
- Timestamp
- Action performed
- Affected resources
- Before/after values

### Permission Validation
- Guards check user permissions before allowing access
- Dynamic permission checking for flexible authorization
- Multi-tenant permission isolation

## Database Schema

### Tables
- `roles`: Role definitions
- `permissions`: Permission definitions
- `role_permissions`: Many-to-many relationship between roles and permissions
- `user_roles`: Many-to-many relationship between users and roles

### Key Relationships
```
users <- user_roles -> roles <- role_permissions -> permissions
```

## Usage Examples

### Creating a Manager Role
```bash
curl -X POST http://localhost:3000/api/roles \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "store_manager",
    "description": "Manager for a specific store",
    "is_system_role": false
  }'
```

### Assigning Permissions
```bash
curl -X POST http://localhost:3000/api/roles/1/permissions \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "permissionIds": [1, 2, 3, 4, 5]
  }'
```

### Checking User Permissions
```bash
curl -X GET http://localhost:3000/api/roles/user/123/permissions \
  -H "Authorization: Bearer <admin_token>"
```

## Error Handling

### Common Error Responses
- `400 Bad Request`: Invalid data or constraint violation
- `401 Unauthorized`: Missing or invalid authentication
- `403 Forbidden`: Insufficient permissions
- `404 Not Found`: Resource not found
- `409 Conflict`: Duplicate resource or constraint violation

### Validation Rules
- Role names must be unique
- System roles cannot be modified or deleted
- Users cannot be left without roles if they have system roles
- Permissions must exist before assignment

## Testing

### Unit Tests
Run role service tests:
```bash
npm run test roles.service.spec.ts
```

### E2E Tests
Run role API tests:
```bash
npm run test:e2e roles.e2e-spec.ts
```

## Future Enhancements

- [ ] Permission inheritance (child roles inherit parent permissions)
- [ ] Time-based permissions (temporary access)
- [ ] Permission templates (predefined permission sets)
- [ ] Bulk user role assignments
- [ ] Permission analytics and reporting
