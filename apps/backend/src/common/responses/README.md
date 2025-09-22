# Standardized Response Service

This service provides a consistent way to format API responses across the application.

## Installation

The ResponseModule is already imported in the AuthModule and UsersModule. To use it in other modules:

1. Import the ResponseModule in your module:
```typescript
import { ResponseModule } from '../common/responses/response.module';

@Module({
  imports: [ResponseModule],
  // ...
})
export class YourModule {}
```

2. Inject the ResponseService in your controller:
```typescript
import { ResponseService } from '../common/responses/response.service';

@Controller('your-controller')
export class YourController {
  constructor(
    private readonly responseService: ResponseService,
  ) {}
}
```

## Usage

### Success Response
```typescript
return this.responseService.success(data, 'Operation completed successfully', request.url);
```

### Created Response
```typescript
return this.responseService.created(data, 'Resource created successfully', request.url);
```

### Paginated Response
```typescript
return this.responseService.paginated(
  data,
  {
    total: 100,
    page: 1,
    limit: 10,
    totalPages: 10
  },
  'Data retrieved successfully',
  request.url
);
```

### Error Response
```typescript
return this.responseService.error('Error message', errorDetails, request.url);
```

### Deleted Response
```typescript
return this.responseService.deleted('Resource deleted successfully', request.url);
```

## Response Formats

### Success Response Format
```json
{
  "success": true,
  "message": "Operation completed successfully",
  "data": {},
  "timestamp": "2023-01-01T00:00:00.000Z",
  "path": "/api/resource"
}
```

### Paginated Response Format
```json
{
  "success": true,
  "message": "Data retrieved successfully",
  "data": [],
  "meta": {
    "total": 100,
    "page": 1,
    "limit": 10,
    "totalPages": 10
  },
  "timestamp": "2023-01-01T00:00:00.000Z",
  "path": "/api/resource"
}
```

### Error Response Format
```json
{
  "success": false,
  "message": "Error message",
  "data": null,
  "error": {
    "details": {}
  },
  "timestamp": "2023-01-01T00:00:00.000Z",
  "path": "/api/resource"
}
```