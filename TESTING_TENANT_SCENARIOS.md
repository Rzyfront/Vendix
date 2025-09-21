# Testing Tenant Scenarios in Vendix

This document provides comprehensive instructions for testing all tenant scenarios in the Vendix multitenant application using the virtual host configuration.

## 1. Prerequisites

Before testing, ensure you have:

1. Completed the virtual host setup as described in `VIRTUAL_HOST_SETUP.md`
2. The backend running on port 3000
3. The frontend running on port 4200
4. Nginx configured and running (if using)
5. Test data configured in the database

## 2. Test Data Requirements

To properly test all scenarios, you'll need the following test data in your database:

### Organizations
- Vendix (ID: 1) - Core organization
- Mordoc (ID: 2) - Test organization
- Tenant1 (ID: 3) - Development testing organization

### Stores
- Luda (ID: 1, Organization: 2) - Test store
- Store1 (ID: 2, Organization: 3) - Development testing store

### Domain Settings
Configure the following domain settings in the `domain_settings` table:

```sql
-- Core Vendix domains
INSERT INTO domain_settings (hostname, organization_id, store_id, config) VALUES
('vendix.localhost', 1, NULL, '{"environment": "vendix_landing", "branding": {"name": "Vendix"}}'),
('admin.vendix.localhost', 1, NULL, '{"environment": "vendix_admin", "branding": {"name": "Vendix Admin"}}');

-- Organization domains
INSERT INTO domain_settings (hostname, organization_id, store_id, config) VALUES
('mordoc.localhost', 2, NULL, '{"environment": "org_landing", "branding": {"name": "Mordoc"}}'),
('app.mordoc.localhost', 2, NULL, '{"environment": "org_admin", "branding": {"name": "Mordoc Admin"}}');

-- Store domains
INSERT INTO domain_settings (hostname, organization_id, store_id, config) VALUES
('luda.mordoc.localhost', 2, 1, '{"environment": "store_ecommerce", "branding": {"name": "Luda Store"}}'),
('admin.luda.mordoc.localhost', 2, 1, '{"environment": "store_admin", "branding": {"name": "Luda Admin"}}');

-- Custom store domains
INSERT INTO domain_settings (hostname, organization_id, store_id, config) VALUES
('luda.localhost', NULL, 1, '{"environment": "store_ecommerce", "branding": {"name": "Luda Custom"}}'),
('admin.luda.localhost', NULL, 1, '{"environment": "store_admin", "branding": {"name": "Luda Custom Admin"}}');

-- Development testing domains
INSERT INTO domain_settings (hostname, organization_id, store_id, config) VALUES
('tenant1.vendix.localhost', 3, NULL, '{"environment": "org_landing", "branding": {"name": "Tenant1"}}'),
('store1.tenant1.vendix.localhost', 3, 2, '{"environment": "store_ecommerce", "branding": {"name": "Store1"}}');
```

## 3. Testing Procedures

### 3.1 Vendix Core Landing Page

1. Navigate to `http://vendix.localhost`
2. Verify:
   - Main landing page loads correctly
   - Vendix branding is displayed
   - Navigation to auth pages works
   - No tenant-specific content is shown

### 3.2 Vendix Admin Panel

1. Navigate to `http://admin.vendix.localhost`
2. Log in as a super admin user
3. Verify:
   - Admin dashboard loads
   - Access to global settings
   - Ability to manage organizations
   - No tenant-specific data is shown

### 3.3 Organization Landing Page

1. Navigate to `http://mordoc.localhost`
2. Verify:
   - Organization-specific landing page loads
   - Mordoc branding is displayed
   - Organization-specific content is shown
   - Links to organization stores work

### 3.4 Organization Admin Panel

1. Navigate to `http://app.mordoc.localhost`
2. Log in as an organization admin user
3. Verify:
   - Organization admin dashboard loads
   - Access to organization stores
   - Ability to manage organization users
   - Organization-specific settings are available

### 3.5 Store E-commerce Frontend

1. Navigate to `http://luda.mordoc.localhost`
2. Verify:
   - Storefront loads correctly
   - Luda store branding is displayed
   - Products are shown
   - Shopping cart functionality works
   - Checkout process is accessible

### 3.6 Store Admin Panel

1. Navigate to `http://admin.luda.mordoc.localhost`
2. Log in as a store admin user
3. Verify:
   - Store admin dashboard loads
   - Access to store products
   - Order management works
   - Inventory management is available
   - Store-specific settings are accessible

### 3.7 Custom Store Domain

1. Navigate to `http://luda.localhost`
2. Verify:
   - Storefront loads with custom domain branding
   - All e-commerce functionality works
   - No references to parent organization in UI
   - SEO settings are applied correctly

### 3.8 Custom Store Admin Panel

1. Navigate to `http://admin.luda.localhost`
2. Log in as a store admin user
3. Verify:
   - Store admin panel loads with custom domain settings
   - All admin functionality works
   - Store-specific branding is applied

### 3.9 Development Testing Domains

1. Navigate to `http://tenant1.vendix.localhost`
2. Verify:
   - Generic tenant landing page loads
   - Tenant1 branding is displayed
   - Basic functionality works

3. Navigate to `http://store1.tenant1.vendix.localhost`
4. Verify:
   - Generic store frontend loads
   - Store1 branding is displayed
   - E-commerce functionality works

## 4. API Testing

For each domain type, test the API endpoints:

1. Vendix Core API:
   ```bash
   curl -H "Host: api.vendix.localhost" http://localhost/api/health
   ```

2. Organization API:
   ```bash
   curl -H "Host: api.vendix.localhost" -H "X-Tenant-Domain: mordoc" http://localhost/api/organizations/2
   ```

3. Store API:
   ```bash
   curl -H "Host: api.vendix.localhost" -H "X-Tenant-Domain: luda.mordoc" http://localhost/api/stores/1
   ```

## 5. Authentication Testing

Test authentication flows for each domain type:

1. Register a new user at `http://vendix.localhost/auth/register`
2. Log in as different user types:
   - Super admin at `http://admin.vendix.localhost`
   - Organization admin at `http://app.mordoc.localhost`
   - Store admin at `http://admin.luda.mordoc.localhost`
   - Store customer at `http://luda.mordoc.localhost`

3. Verify that:
   - Users can only access appropriate domains
   - Role-based access control works correctly
   - Session management is tenant-aware
   - Tokens contain correct tenant information

## 6. Theme and Branding Testing

For each tenant type, verify branding customization:

1. Check color schemes match tenant configuration
2. Verify custom logos are displayed
3. Confirm fonts are applied correctly
4. Test favicon customization
5. Validate SEO meta tags
6. Ensure responsive design works for all tenants

## 7. Cross-Tenant Functionality

Test that tenants are properly isolated:

1. Data from one tenant should not appear in another
2. Users from one tenant cannot access another tenant's data
3. Configuration changes in one tenant don't affect others
4. Performance in one tenant doesn't impact others

## 8. Troubleshooting Common Issues

### Domain Not Resolving
1. Check hosts file entries
2. Verify Nginx configuration
3. Restart Nginx service
4. Clear browser cache

### Incorrect Tenant Loading
1. Check domain_settings table in database
2. Verify domain resolution service logic
3. Check frontend domain detection service
4. Review Nginx headers

### Authentication Issues
1. Verify user roles and permissions
2. Check tenant information in JWT tokens
3. Review auth interceptor configuration
4. Test with fresh user sessions

### Branding Not Applied
1. Check tenant configuration in database
2. Verify theme service implementation
3. Review CSS variable application
4. Check for caching issues

## 9. Continuous Testing

Set up automated testing for tenant scenarios:

1. Create Cypress or similar tests for each domain type
2. Implement CI/CD pipeline that tests all tenant scenarios
3. Set up monitoring for domain resolution issues
4. Regularly verify cross-tenant data isolation

## 10. Performance Testing

For production readiness, test:

1. Domain resolution performance
2. Tenant configuration loading times
3. Concurrent access by multiple tenants
4. Resource usage isolation between tenants

This comprehensive testing approach will ensure your multitenant Vendix application works correctly across all domain types and tenant scenarios.