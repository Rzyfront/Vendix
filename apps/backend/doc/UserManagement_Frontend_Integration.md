# VENDIX - User Management Module: Frontend Integration Guide

## 📋 Overview

This guide provides a comprehensive overview of the User Management, Roles, and Permissions services available in the Vendix backend, along with implementation examples for frontend integration.

## 🔐 Authentication Services

### Core Authentication Endpoints

#### 1. Owner Registration
```typescript
// POST /auth/register-owner
const registerOwner = async (data: {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  organizationName: string;
}) => {
  const response = await fetch('/api/auth/register-owner', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  return response.json();
};
```

#### 2. Staff Registration (Admin Only)
```typescript
// POST /auth/register-staff
const registerStaff = async (data: {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  role: 'manager' | 'supervisor' | 'employee';
  store_id?: number;
}) => {
  const response = await fetch('/api/auth/register-staff', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(data)
  });
  return response.json();
};
```

#### 3. Customer Registration
```typescript
// POST /auth/register-customer
const registerCustomer = async (data: {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  storeId: number;
}) => {
  const response = await fetch('/api/auth/register-customer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  return response.json();
};
```

#### 4. Login
```typescript
// POST /auth/login
const login = async (data: {
  email: string;
  password: string;
  organizationSlug?: string;
  storeSlug?: string;
}) => {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  const result = await response.json();

  if (result.data) {
    // Store tokens
    localStorage.setItem('access_token', result.data.access_token);
    localStorage.setItem('refresh_token', result.data.refresh_token);
  }

  return result;
};
```

#### 5. Logout
```typescript
// POST /auth/logout
const logout = async (allSessions = false, refreshToken?: string) => {
  const response = await fetch('/api/auth/logout', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${localStorage.getItem('access_token')}`
    },
    body: JSON.stringify({
      all_sessions: allSessions,
      refresh_token: refreshToken
    })
  });
  return response.json();
};
```

#### 6. Refresh Token
```typescript
// POST /auth/refresh
const refreshToken = async () => {
  const response = await fetch('/api/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      refresh_token: localStorage.getItem('refresh_token')
    })
  });

  const result = await response.json();
  if (result.data) {
    localStorage.setItem('access_token', result.data.access_token);
    localStorage.setItem('refresh_token', result.data.refresh_token);
  }

  return result;
};
```

### Email Verification & Password Recovery

#### 7. Verify Email
```typescript
// POST /auth/verify-email
const verifyEmail = async (token: string) => {
  const response = await fetch('/api/auth/verify-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token })
  });
  return response.json();
};
```

#### 8. Resend Verification
```typescript
// POST /auth/resend-verification
const resendVerification = async (email: string) => {
  const response = await fetch('/api/auth/resend-verification', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email })
  });
  return response.json();
};
```

#### 9. Forgot Password
```typescript
// POST /auth/forgot-password
const forgotPassword = async (email: string, organizationSlug: string) => {
  const response = await fetch('/api/auth/forgot-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, organization_slug: organizationSlug })
  });
  return response.json();
};
```

#### 10. Reset Password
```typescript
// POST /auth/reset-password
const resetPassword = async (token: string, newPassword: string) => {
  const response = await fetch('/api/auth/reset-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, newPassword })
  });
  return response.json();
};
```

## 👥 User Management Services

### CRUD Operations

#### 11. Create User
```typescript
// POST /users
const createUser = async (data: {
  organization_id: number;
  first_name: string;
  last_name: string;
  username: string;
  email: string;
  password: string;
  state?: 'active' | 'inactive';
}) => {
  const response = await fetch('/api/users', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(data)
  });
  return response.json();
};
```

#### 12. List Users
```typescript
// GET /users
const getUsers = async (params: {
  page?: number;
  limit?: number;
  search?: string;
  state?: 'active' | 'inactive' | 'suspended' | 'archived';
  organization_id?: number;
}) => {
  const queryString = new URLSearchParams(params as any).toString();
  const response = await fetch(`/api/users?${queryString}`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  return response.json();
};
```

#### 13. Get User Details
```typescript
// GET /users/:id
const getUser = async (userId: number) => {
  const response = await fetch(`/api/users/${userId}`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  return response.json();
};
```

#### 14. Update User
```typescript
// PATCH /users/:id
const updateUser = async (userId: number, data: {
  first_name?: string;
  last_name?: string;
  email?: string;
  state?: 'active' | 'inactive';
}) => {
  const response = await fetch(`/api/users/${userId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(data)
  });
  return response.json();
};
```

#### 15. Suspend User (Soft Delete)
```typescript
// DELETE /users/:id
const suspendUser = async (userId: number) => {
  const response = await fetch(`/api/users/${userId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  return response.json();
};
```

#### 16. Archive User
```typescript
// POST /users/:id/archive
const archiveUser = async (userId: number) => {
  const response = await fetch(`/api/users/${userId}/archive`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  return response.json();
};
```

#### 17. Reactivate User
```typescript
// POST /users/:id/reactivate
const reactivateUser = async (userId: number) => {
  const response = await fetch(`/api/users/${userId}/reactivate`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  return response.json();
};
```

## 🛡️ Role Management Services

### Role CRUD

#### 18. Create Role
```typescript
// POST /roles
const createRole = async (data: {
  name: string;
  description?: string;
  is_system_role?: boolean;
}) => {
  const response = await fetch('/api/roles', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(data)
  });
  return response.json();
};
```

#### 19. List Roles
```typescript
// GET /roles
const getRoles = async () => {
  const response = await fetch('/api/roles', {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  return response.json();
};
```

#### 20. Get Role Details
```typescript
// GET /roles/:id
const getRole = async (roleId: number) => {
  const response = await fetch(`/api/roles/${roleId}`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  return response.json();
};
```

#### 21. Update Role
```typescript
// PATCH /roles/:id
const updateRole = async (roleId: number, data: {
  name?: string;
  description?: string;
}) => {
  const response = await fetch(`/api/roles/${roleId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(data)
  });
  return response.json();
};
```

#### 22. Delete Role
```typescript
// DELETE /roles/:id
const deleteRole = async (roleId: number) => {
  const response = await fetch(`/api/roles/${roleId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  return response.json();
};
```

### Permission Management

#### 23. Assign Permissions to Role
```typescript
// POST /roles/:id/permissions
const assignPermissionsToRole = async (roleId: number, data: {
  permissionIds: number[];
}) => {
  const response = await fetch(`/api/roles/${roleId}/permissions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(data)
  });
  return response.json();
};
```

#### 24. Remove Permissions from Role
```typescript
// DELETE /roles/:id/permissions
const removePermissionsFromRole = async (roleId: number, data: {
  permissionIds: number[];
}) => {
  const response = await fetch(`/api/roles/${roleId}/permissions`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(data)
  });
  return response.json();
};
```

### User-Role Assignment

#### 25. Assign Role to User
```typescript
// POST /roles/assign-to-user
const assignRoleToUser = async (data: {
  userId: number;
  roleId: number;
}) => {
  const response = await fetch('/api/roles/assign-to-user', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(data)
  });
  return response.json();
};
```

#### 26. Remove Role from User
```typescript
// POST /roles/remove-from-user
const removeRoleFromUser = async (data: {
  userId: number;
  roleId: number;
}) => {
  const response = await fetch('/api/roles/remove-from-user', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(data)
  });
  return response.json();
};
```

#### 27. Get User Roles
```typescript
// GET /roles/user/:userId/roles
const getUserRoles = async (userId: number) => {
  const response = await fetch(`/api/roles/user/${userId}/roles`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  return response.json();
};
```

#### 28. Get User Permissions
```typescript
// GET /roles/user/:userId/permissions
const getUserPermissions = async (userId: number) => {
  const response = await fetch(`/api/roles/user/${userId}/permissions`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  return response.json();
};
```

## 🎯 Frontend Implementation Patterns

### 1. Authentication Service
```typescript
class AuthService {
  private token: string | null = null;

  async login(credentials: LoginCredentials) {
    const response = await login(credentials);
    if (response.data) {
      this.token = response.data.access_token;
      localStorage.setItem('token', this.token);
      localStorage.setItem('refreshToken', response.data.refresh_token);
    }
    return response;
  }

  async logout(allSessions = false) {
    const refreshToken = localStorage.getItem('refreshToken');
    await logout(allSessions, refreshToken);
    this.clearTokens();
  }

  private clearTokens() {
    this.token = null;
    localStorage.removeItem('token');
    localStorage.removeItem('refreshToken');
  }

  getToken() {
    return this.token || localStorage.getItem('token');
  }
}
```

### 2. HTTP Interceptor for Authentication
```typescript
class AuthInterceptor {
  intercept(request: any, next: any) {
    const token = authService.getToken();
    if (token) {
      request.headers.set('Authorization', `Bearer ${token}`);
    }
    return next.handle(request);
  }
}
```

### 3. Permission-Based Component Guard
```typescript
const PermissionGuard = ({ permission, children }: {
  permission: string;
  children: React.ReactNode;
}) => {
  const userPermissions = useUserPermissions();

  if (!userPermissions.includes(permission)) {
    return <AccessDenied />;
  }

  return <>{children}</>;
};
```

### 4. User Management Hook
```typescript
const useUsers = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchUsers = async (params = {}) => {
    setLoading(true);
    try {
      const response = await getUsers(params);
      setUsers(response.data);
    } finally {
      setLoading(false);
    }
  };

  const createUser = async (userData: any) => {
    const response = await createUser(userData);
    if (response.success) {
      fetchUsers(); // Refresh list
    }
    return response;
  };

  return { users, loading, fetchUsers, createUser };
};
```

### 5. Role Management Hook
```typescript
const useRoles = () => {
  const [roles, setRoles] = useState([]);

  const fetchRoles = async () => {
    const response = await getRoles();
    setRoles(response.data);
  };

  const assignRole = async (userId: number, roleId: number) => {
    return await assignRoleToUser({ userId, roleId });
  };

  return { roles, fetchRoles, assignRole };
};
```

## 🔐 Permission Requirements

| Operation | Required Permission |
|-----------|---------------------|
| Create User | `users:create` |
| Read Users | `users:read` |
| Update User | `users:update` |
| Delete User | `users:delete` |
| Create Role | Super Admin/Admin only |
| Manage Permissions | Super Admin/Admin only |

## 🚨 Error Handling

```typescript
const handleApiError = (error: any) => {
  if (error.status === 401) {
    // Token expired, redirect to login
    authService.logout();
    router.push('/login');
  } else if (error.status === 403) {
    // Permission denied
    showNotification('No tienes permisos para esta acción', 'error');
  } else if (error.status === 409) {
    // Conflict (duplicate email, etc.)
    showNotification(error.message, 'warning');
  }
};
```

## 📱 UI Components Examples

### User List Component
```typescript
const UserList = () => {
  const { users, loading, fetchUsers } = useUsers();
  const [filters, setFilters] = useState({});

  useEffect(() => {
    fetchUsers(filters);
  }, [filters]);

  return (
    <div>
      <UserFilters onChange={setFilters} />
      {loading ? (
        <Spinner />
      ) : (
        <UserTable
          users={users}
          onEdit={handleEdit}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
};
```

### Role Assignment Component
```typescript
const RoleAssignment = ({ userId }: { userId: number }) => {
  const { roles, assignRole } = useRoles();
  const [selectedRole, setSelectedRole] = useState('');

  const handleAssign = async () => {
    if (selectedRole) {
      await assignRole(userId, parseInt(selectedRole));
      // Refresh user data
    }
  };

  return (
    <PermissionGuard permission="roles:assign">
      <select value={selectedRole} onChange={e => setSelectedRole(e.target.value)}>
        <option value="">Select Role</option>
        {roles.map(role => (
          <option key={role.id} value={role.id}>{role.name}</option>
        ))}
      </select>
      <button onClick={handleAssign}>Assign Role</button>
    </PermissionGuard>
  );
};
```

## 🔄 State Management Integration

### Redux/Auth Slice
```typescript
const authSlice = createSlice({
  name: 'auth',
  initialState: {
    user: null,
    token: null,
    permissions: [],
    isAuthenticated: false
  },
  reducers: {
    setCredentials: (state, action) => {
      state.user = action.payload.user;
      state.token = action.payload.token;
      state.permissions = action.payload.permissions;
      state.isAuthenticated = true;
    },
    logout: (state) => {
      state.user = null;
      state.token = null;
      state.permissions = [];
      state.isAuthenticated = false;
    }
  }
});
```

This guide covers all the essential services and implementation patterns needed to integrate the User Management, Roles, and Permissions module into your frontend application.