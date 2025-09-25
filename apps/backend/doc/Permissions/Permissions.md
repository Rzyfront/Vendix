# Permissions Module - Complete CRUD Operations

## Overview

The Permissions module provides complete CRUD operations for managing permissions in the Vendix system. Permissions are used to control access to specific endpoints and resources.

## Database Schema

```sql
model permissions {
  id               Int                    @id @default(autoincrement())
  name             String                 @unique @db.VarChar(100)
  description      String?
  path             String                 @db.VarChar(255)
  method           http_method_enum
  status           permission_status_enum @default(active)
  created_at       DateTime?              @default(now()) @db.Timestamp(6)
  updated_at       DateTime?              @default(now()) @db.Timestamp(6)
  role_permissions role_permissions[]

  @@unique([path, method])
}
```

## API Endpoints

### Base URL
```
/api/permissions
```

### Authentication
All endpoints require JWT authentication and appropriate role permissions.

---

## 1. Create Permission

**Endpoint:** `POST /api/permissions`

**Required Roles:** `SUPER_ADMIN`, `ADMIN`

**Request Body:**
```json
{
  "name": "users.create",
  "description": "Permite crear nuevos usuarios en el sistema",
  "path": "/api/users",
  "method": "POST",
  "status": "active"
}
```

**Response (201):**
```json
{
  "success": true,
  "message": "Permiso creado exitosamente",
  "data": {
    "id": 1,
    "name": "users.create",
    "description": "Permite crear nuevos usuarios en el sistema",
    "path": "/api/users",
    "method": "POST",
    "status": "active",
    "created_at": "2025-09-25T02:35:00.000Z",
    "updated_at": "2025-09-25T02:35:00.000Z",
    "role_permissions": []
  }
}
```

**Error Responses:**
- `400`: Datos inválidos
- `409`: Ya existe un permiso con este nombre o ruta/método

---

## 2. Get All Permissions

**Endpoint:** `GET /api/permissions`

**Required Roles:** `SUPER_ADMIN`, `ADMIN`, `MANAGER`

**Query Parameters:**
- `method` (optional): Filter by HTTP method (`GET`, `POST`, `PUT`, `DELETE`, `PATCH`, `OPTIONS`, `HEAD`)
- `status` (optional): Filter by status (`active`, `inactive`, `deprecated`)
- `search` (optional): Search by name, description, or path

**Example:** `GET /api/permissions?method=GET&status=active&search=user`

**Response (200):**
```json
{
  "success": true,
  "message": "Lista de permisos obtenida exitosamente",
  "data": [
    {
      "id": 1,
      "name": "users.create",
      "description": "Permite crear nuevos usuarios",
      "path": "/api/users",
      "method": "POST",
      "status": "active",
      "created_at": "2025-09-25T02:35:00.000Z",
      "updated_at": "2025-09-25T02:35:00.000Z",
      "role_permissions": [
        {
          "id": 1,
          "role_id": 2,
          "permission_id": 1,
          "granted": true,
          "created_at": "2025-09-25T02:35:00.000Z",
          "roles": {
            "id": 2,
            "name": "admin",
            "description": "Administrator role"
          }
        }
      ],
      "_count": {
        "role_permissions": 1
      }
    }
  ],
  "url": "/api/permissions?method=GET&status=active&search=user"
}
```

---

## 3. Get Permission by ID

**Endpoint:** `GET /api/permissions/:id`

**Required Roles:** `SUPER_ADMIN`, `ADMIN`, `MANAGER`

**Response (200):**
```json
{
  "success": true,
  "message": "Permiso encontrado",
  "data": {
    "id": 1,
    "name": "users.create",
    "description": "Permite crear nuevos usuarios",
    "path": "/api/users",
    "method": "POST",
    "status": "active",
    "created_at": "2025-09-25T02:35:00.000Z",
    "updated_at": "2025-09-25T02:35:00.000Z",
    "role_permissions": [...],
    "_count": {
      "role_permissions": 1
    }
  },
  "url": "/api/permissions/1"
}
```

**Error Response (404):**
```json
{
  "success": false,
  "message": "Error al obtener el permiso",
  "error": "Permiso no encontrado"
}
```

---

## 4. Update Permission

**Endpoint:** `PATCH /api/permissions/:id`

**Required Roles:** `SUPER_ADMIN`, `ADMIN`

**Request Body (partial update):**
```json
{
  "description": "Permite crear usuarios administradores",
  "status": "active"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Permiso actualizado exitosamente",
  "data": {
    "id": 1,
    "name": "users.create",
    "description": "Permite crear usuarios administradores",
    "path": "/api/users",
    "method": "POST",
    "status": "active",
    "created_at": "2025-09-25T02:35:00.000Z",
    "updated_at": "2025-09-25T02:35:10.000Z",
    "role_permissions": [...]
  },
  "url": "/api/permissions/1"
}
```

**Error Responses:**
- `400`: Datos inválidos
- `404`: Permiso no encontrado
- `409`: Ya existe un permiso con este nombre o ruta/método

---

## 5. Delete Permission

**Endpoint:** `DELETE /api/permissions/:id`

**Required Roles:** `SUPER_ADMIN`, `ADMIN`

**Response (200):**
```json
{
  "success": true,
  "message": "Permiso eliminado exitosamente",
  "data": {
    "message": "Permiso eliminado exitosamente"
  },
  "url": "/api/permissions/1"
}
```

**Error Responses:**
- `400`: No se puede eliminar el permiso (tiene roles asignados)
- `404`: Permiso no encontrado

---

## 6. Search Permission by Name

**Endpoint:** `GET /api/permissions/search/by-name/:name`

**Required Roles:** `SUPER_ADMIN`, `ADMIN`, `MANAGER`

**Example:** `GET /api/permissions/search/by-name/users.create`

**Response (200):**
```json
{
  "success": true,
  "message": "Permiso encontrado",
  "data": {
    "id": 1,
    "name": "users.create",
    "description": "Permite crear usuarios administradores",
    "path": "/api/users",
    "method": "POST",
    "status": "active",
    "created_at": "2025-09-25T02:35:00.000Z",
    "updated_at": "2025-09-25T02:35:10.000Z"
  },
  "url": "/api/permissions/search/by-name/users.create"
}
```

---

## 7. Search Permission by Path and Method

**Endpoint:** `GET /api/permissions/search/by-path-method`

**Required Roles:** `SUPER_ADMIN`, `ADMIN`, `MANAGER`

**Query Parameters:**
- `path` (required): Endpoint path
- `method` (required): HTTP method

**Example:** `GET /api/permissions/search/by-path-method?path=/api/users&method=POST`

**Response (200):**
```json
{
  "success": true,
  "message": "Permiso encontrado",
  "data": {
    "id": 1,
    "name": "users.create",
    "description": "Permite crear usuarios administradores",
    "path": "/api/users",
    "method": "POST",
    "status": "active",
    "created_at": "2025-09-25T02:35:00.000Z",
    "updated_at": "2025-09-25T02:35:10.000Z"
  },
  "url": "/api/permissions/search/by-path-method?path=/api/users&method=POST"
}
```

---

# Roles Module - Complete CRUD Operations

## Overview

The Roles module manages user roles and their associated permissions. Roles are used to group permissions and assign them to users.

## Database Schema

```sql
model roles {
  id               Int                @id @default(autoincrement())
  name             String             @unique @db.VarChar(50)
  description      String?
  is_system_role   Boolean            @default(false)
  created_at       DateTime?          @default(now()) @db.Timestamp(6)
  updated_at       DateTime?          @default(now()) @db.Timestamp(6)
  role_permissions role_permissions[]
  user_roles       user_roles[]
}

model role_permissions {
  id            Int         @id @default(autoincrement())
  role_id       Int
  permission_id Int
  granted       Boolean     @default(true)
  created_at    DateTime?   @default(now()) @db.Timestamp(6)
  permissions   permissions @relation(fields: [permission_id], references: [id], onDelete: Cascade, onUpdate: NoAction)
  roles         roles       @relation(fields: [role_id], references: [id], onDelete: Cascade, onUpdate: NoAction)

  @@unique([role_id, permission_id])
}
```

## API Endpoints

### Base URL
```
/api/roles
```

---

## 1. Create Role

**Endpoint:** `POST /api/roles`

**Required Roles:** `SUPER_ADMIN`, `ADMIN`

**Request Body:**
```json
{
  "name": "manager",
  "description": "Store manager role",
  "is_system_role": false
}
```

**Response (201):**
```json
{
  "success": true,
  "message": "Rol creado exitosamente",
  "data": {
    "id": 3,
    "name": "manager",
    "description": "Store manager role",
    "is_system_role": false,
    "created_at": "2025-09-25T02:35:00.000Z",
    "updated_at": "2025-09-25T02:35:00.000Z",
    "role_permissions": [],
    "user_roles": []
  }
}
```

---

## 2. Get All Roles

**Endpoint:** `GET /api/roles`

**Required Roles:** `SUPER_ADMIN`, `ADMIN`, `MANAGER`

**Response (200):**
```json
{
  "success": true,
  "message": "Lista de roles obtenida exitosamente",
  "data": [
    {
      "id": 1,
      "name": "super_admin",
      "description": "Super administrator with full access",
      "is_system_role": true,
      "created_at": "2025-09-25T02:35:00.000Z",
      "updated_at": "2025-09-25T02:35:00.000Z",
      "role_permissions": [...],
      "_count": {
        "user_roles": 1
      }
    },
    {
      "id": 2,
      "name": "admin",
      "description": "Administrator role",
      "is_system_role": true,
      "created_at": "2025-09-25T02:35:00.000Z",
      "updated_at": "2025-09-25T02:35:00.000Z",
      "role_permissions": [...],
      "_count": {
        "user_roles": 5
      }
    }
  ],
  "url": "/api/roles"
}
```

---

## 3. Get Role by ID

**Endpoint:** `GET /api/roles/:id`

**Required Roles:** `SUPER_ADMIN`, `ADMIN`, `MANAGER`

---

## 4. Update Role

**Endpoint:** `PATCH /api/roles/:id`

**Required Roles:** `SUPER_ADMIN`, `ADMIN`

**Notes:**
- System roles (`is_system_role: true`) cannot be modified

---

## 5. Delete Role

**Endpoint:** `DELETE /api/roles/:id`

**Required Roles:** `SUPER_ADMIN`, `ADMIN`

**Notes:**
- System roles cannot be deleted
- Roles with assigned users cannot be deleted

---

## 6. Assign Permissions to Role

**Endpoint:** `POST /api/roles/:id/permissions`

**Required Roles:** `SUPER_ADMIN`, `ADMIN`

**Request Body:**
```json
{
  "permissionIds": [1, 2, 3]
}
```

---

## 7. Remove Permissions from Role

**Endpoint:** `DELETE /api/roles/:id/permissions`

**Required Roles:** `SUPER_ADMIN`, `ADMIN`

**Request Body:**
```json
{
  "permissionIds": [2]
}
```

---

## 8. Assign Role to User

**Endpoint:** `POST /api/roles/assign-to-user`

**Required Roles:** `SUPER_ADMIN`, `ADMIN`

**Request Body:**
```json
{
  "userId": 5,
  "roleId": 2
}
```

**Notes:**
- Only one super_admin can exist in the system

---

## 9. Remove Role from User

**Endpoint:** `POST /api/roles/remove-from-user`

**Required Roles:** `SUPER_ADMIN`, `ADMIN`

**Request Body:**
```json
{
  "userId": 5,
  "roleId": 2
}
```

**Notes:**
- Users cannot be left without any system role

---

## 10. Get User Permissions

**Endpoint:** `GET /api/roles/user/:userId/permissions`

**Required Roles:** `SUPER_ADMIN`, `ADMIN`, `MANAGER`

---

## 11. Get User Roles

**Endpoint:** `GET /api/roles/user/:userId/roles`

**Required Roles:** `SUPER_ADMIN`, `ADMIN`, `MANAGER`

---

# Complete Workflow Examples

## 1. Creating a New Role with Permissions

```bash
# 1. Create permissions
POST /api/permissions
{
  "name": "products.create",
  "description": "Create new products",
  "path": "/api/products",
  "method": "POST"
}

POST /api/permissions
{
  "name": "products.update",
  "description": "Update existing products",
  "path": "/api/products",
  "method": "PUT"
}

# 2. Create role
POST /api/roles
{
  "name": "product_manager",
  "description": "Product management role"
}

# 3. Assign permissions to role
POST /api/roles/3/permissions
{
  "permissionIds": [4, 5]  // IDs of the created permissions
}

# 4. Assign role to user
POST /api/roles/assign-to-user
{
  "userId": 10,
  "roleId": 3
}
```

## 2. Managing Existing Permissions

```bash
# Get all permissions
GET /api/permissions

# Update a permission
PATCH /api/permissions/1
{
  "description": "Updated description"
}

# Search permissions
GET /api/permissions?search=product&method=POST
```

## 3. User Role Management

```bash
# Get user's current roles
GET /api/roles/user/10/roles

# Get user's effective permissions
GET /api/roles/user/10/permissions

# Change user's role
POST /api/roles/remove-from-user
{
  "userId": 10,
  "roleId": 2
}

POST /api/roles/assign-to-user
{
  "userId": 10,
  "roleId": 4
}
```

---

# Security Considerations

1. **System Roles Protection**: Roles marked as `is_system_role: true` cannot be modified or deleted
2. **Super Admin Uniqueness**: Only one user can have the `super_admin` role
3. **Role Dependencies**: Roles with assigned users cannot be deleted
4. **Permission Dependencies**: Permissions assigned to roles cannot be deleted
5. **Audit Logging**: All operations are logged for security and compliance

---

# Enums

## HTTP Methods
- `GET`
- `POST`
- `PUT`
- `DELETE`
- `PATCH`
- `OPTIONS`
- `HEAD`

## Permission Status
- `active` (default)
- `inactive`
- `deprecated`

## User Roles (System)
- `SUPER_ADMIN`: Full system access
- `ADMIN`: Administrative access
- `MANAGER`: Management access
- `STAFF`: Staff access
- `CUSTOMER`: Customer access