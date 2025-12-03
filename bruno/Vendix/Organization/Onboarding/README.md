# Onboarding Flow Tests

This folder contains comprehensive tests for the complete onboarding flow of the Vendix API.

## ⚠️ Important Note

Bruno has limitations with complex variable handling between requests. For this reason, some IDs need to be manually updated after each step:

1. After **Owner Registration**: Copy the `access_token` and update `ownerToken`, copy the user `id` and update `userId` in Environment Variables
2. After **Create Organization**: Copy the organization `id` and update `organizationId` in Environment Variables
3. After **Create Store**: Copy the store `id` and update `storeId` in Environment Variables
4. After **Create Domain**: Copy the domain `id` and update `domainId` in Environment Variables

## 🚀 Development Flow

For development, the **Email Verification** step uses a bypass service that allows you to verify emails without sending actual emails:

### Development Flow:

1. **Environment Variables** - Set up test variables (run first)
2. **Owner Registration** - Register a new organization owner
3. **Email Verification** - 🚀 Verify email using development bypass service
4. **Login After Verification** - Login with verified credentials
5. Continue with the rest of the flow...

## Test Structure

### Main Flow Tests (Sequential)

1. **Environment Variables** - Set up test variables (run first)
2. **Owner Registration** - Register a new organization owner
3. **Email Verification** - 🚀 Verify email using bypass service
4. **Login After Verification** - Login with verified credentials
5. **Check Onboarding Status** - Check current onboarding progress
6. **Create Organization** - Create the organization entity
7. **Setup Organization Details** - Configure organization settings
8. **Create Organization Address** - Add organization address
9. **Create Store** - Create a store for the organization
10. **Setup Store Details** - Configure store settings and business hours
11. **Create Store Address** - Add store address
12. **Check Domain Availability** - Check if domain is available
13. **Create Domain** - Configure domain settings
14. **Verify Domain DNS** - Initiate DNS verification
15. **Complete Onboarding** - Mark onboarding as complete
16. **Verify Final State** - Confirm everything is set up correctly

### Error Cases Tests

- **Invalid Registration** - Test validation errors
- **Duplicate Email Registration** - Test duplicate email handling
- **Invalid Login Credentials** - Test authentication failures
- **Unauthorized Access** - Test authorization failures
- **Invalid Organization Data** - Test organization validation
- **Domain Already Taken** - Test domain uniqueness
- **Complete Onboarding Without Requirements** - Test completion validation

## Usage

1. **Set up environment**: Run "Environment Variables" first
2. **Run the flow**: Execute tests sequentially from 2-16
3. **Update IDs manually**: After each creation step, copy the IDs and update Environment Variables
4. **Test error cases**: Run individual error case tests

## Manual Variable Updates

After each step, you'll need to manually update variables:

### After Owner Registration (Step 2):

```json
{
  "ownerToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "userId": 1
}
```

### After Create Organization (Step 6):

```json
{
  "organizationId": "org_1234567890abcdef"
}
```

### After Create Store (Step 9):

```json
{
  "storeId": "store_1234567890abcdef"
}
```

### After Create Domain (Step 13):

```json
{
  "domainId": "domain_1234567890abcdef"
}
```

## Bypass Email Service

The email verification step uses the bypass service (`POST /bypass-email/verify`) which is only available in development mode and allows you to:

- Verify any user's email by providing their `user_id`
- Automatically sets `email_verified: true` and `state: 'active'`
- Bypasses the need for email tokens during development

**Request Body:**

```json
{
  "user_id": 1
}
```

**Response:**

```json
{
  "success": true,
  "message": "Email verificado exitosamente (bypass desarrollo)",
  "user": {
    "id": 1,
    "email": "owner@company.com",
    "email_verified": true,
    "state": "active",
    "first_name": "John",
    "last_name": "Smith"
  }
}
```

## Expected Results

After successful completion of the main flow:

- User account created and verified
- Organization with full details and address
- Store with settings, business hours, and address
- Domain configured and ready for DNS verification
- Onboarding marked as complete
- User has owner role with full permissions

## Notes

- Tests are designed to run in sequence
- Manual variable updates are required due to Bruno limitations
- The **Email Verification** step uses the development bypass service
- Error cases can be run independently
- All tests include assertions to verify expected behavior
- The flow tests the complete onboarding journey from registration to completion
