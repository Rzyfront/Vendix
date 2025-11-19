#!/usr/bin/env node

const axios = require('axios');

// Configuration
const API_URL = 'http://localhost:3000';

// Authentication credentials (using your token)
const AUTH_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOjU3LCJlbWFpbCI6InN1cGVyYWRtaW5AdmVuZGl4LmNvbSIsInJvbGVzIjpbInN1cGVyX2FkbWluIl0sInBlcm1pc3Npb25zIjpbImF1dGgucmVnaXN0ZXIub3duZXIiLCJhdXRoLnJlZ2lzdGVyLmN1c3RvbWVyIiwiYXV0aC5yZWdpc3Rlci5zdGFmZiIsImF1dGgubG9naW4iLCJhdXRoLnJlZnJlc2giLCJhdXRoLnByb2ZpbGUiLCJhdXRoLmxvZ291dCIsImF1dGgubWUiLCJhdXRoLnZlcmlmeS5lbWFpbCIsImF1dGgucmVzZW5kLnZlcmlmaWNhdGlvbiIsImF1dGguZm9yZ290Lm93bmVyLnBhc3N3b3JkIiwiYXV0aC5yZXNldC5vd25lci5wYXNzd29yZCIsImF1dGguY2hhbmdlLnBhc3N3b3JkIiwiYXV0aC5zZXNzaW9ucyIsImF1dGgucmV2b2tlLnNlc3Npb24iLCJhdXRoLm9uYm9hcmRpbmcuc3RhdHVzIiwiYXV0aC5vbmJvYXJkaW5nLmNyZWF0ZS5vcmdhbml6YXRpb24iLCJhdXRoLm9uYm9hcmRpbmcuc2V0dXAub3JnYW5pemF0aW9uIiwiYXV0aC5vbmJvYXJkaW5nLmNyZWF0ZS5zdG9yZSIsImF1dGgub25ib2FyZGluZy5zZXR1cC5zdG9yZSIsImF1dGgub25ib2FyZGluZy5jb21wbGV0ZSIsInVzZXJzLmNyZWF0ZSIsInVzZXJzLnJlYWQiLCJ1c2Vycy5zdGF0cyIsInVzZXJzLnJlYWQub25lIiwidXNlcnMudXBkYXRlIiwidXNlcnMuZGVsZXRlIiwidXNlcnMuYXJjaGl2ZSIsInVzZXJzLnJlYWN0aXZhdGUiLCJvcmdhbml6YXRpb25zLmNyZWF0ZSIsIm9yZ2FuaXphdGlvbnMucmVhZCIsIm9yZ2FuaXphdGlvbnMucmVhZC5vbmUiLCJvcmdhbml6YXRpb25zLnJlYWQuc2x1ZyIsIm9yZ2FuaXphdGlvbnMudXBkYXRlIiwib3JnYW5pemF0aW9ucy5kZWxldGUiLCJvcmdhbml6YXRpb25zLnN0YXRzIiwic3RvcmVzLmNyZWF0ZSIsInN0b3Jlcy5yZWFkIiwic3RvcmVzLnJlYWQub25lIiwic3RvcmVzLnJlYWQuc2x1ZyIsInN0b3Jlcy51cGRhdGUiLCJzdG9yZXMuZGVsZXRlIiwic3RvcmVzLnN0YXRzIiwiY2F0ZWdvcmllcy5jcmVhdGUiLCJjYXRlZ29yaWVzLnJlYWQiLCJjYXRlZ29yaWVzLnJlYWQub25lIiwiY2F0ZWdvcmllcy51cGRhdGUiLCJjYXRlZ29yaWVzLmRlbGV0ZSIsImJyYW5kcy5jcmVhdGUiLCJicmFuZHMucmVhZCIsImJyYW5kcy5yZWFkLnN0b3JlIiwiYnJhbmRzLnJlYWQub25lIiwiYnJhbmRzLnJlYWQuc2x1ZyIsImJyYW5kcy51cGRhdGUiLCJicmFuZHMuYWN0aXZhdGUiLCJicmFuZHMuZGVhY3RpdmF0ZSIsImJyYW5kcy5hZG1pbl9kZWxldGUiLCJhZGRyZXNzZXMuY3JlYXRlIiwiYWRkcmVzc2VzLnJlYWQiLCJhZGRyZXNzZXMucmVhZC5zdG9yZSIsImFkZHJlc3Nlcy5yZWFkLm9uZSIsImFkZHJlc3Nlcy51cGRhdGUiLCJhZGRyZXNzZXMucmVhZC5zdG9yZSIsImFkZHJlc3Nlcy5kZWxldGUiLCJyb2xlcy5jcmVhdGUiLCJyb2xlcy5yZWFkIiwicm9sZXMuc3RhdHMiLCJyb2xlcy5yZWFkLm9uZSIsInJvbGVzLnVwZGF0ZSIsInJvbGVzLmRlbGV0ZSIsInJvbGVzLnBlcm1pc3Npb25zLnJlYWQiLCJyb2xlcy5wZXJtaXNzaW9ucy5hc3NpZ24iLCJyb2xlcy5wZXJtaXNzaW9ucy5yZW1vdmUiLCJyb2xlcy5hc3NpZ24udXNlciIsInJvbGVzLnJlbW92ZS51c2VyIiwicm9sZXMudXNlci5wZXJtaXNzaW9ucyIsInJvbGVzLnVzZXIucm9sZXMiLCJwZXJtaXNzaW9ucy5jcmVhdGUiLCJwZXJtaXNzaW9ucy5yZWFkIiwicGVybWlzc2lvbnMucmVhZC5vbmUiLCJwZXJtaXNzaW9ucy51cGRhdGUiLCJwZXJtaXNzaW9ucy5kZWxldGUiLCJwZXJtaXNzaW9ucy5zZWFyY2gubmFtZSIsInBlcm1pc3Npb25zLnNlYXJjaC5wYXRoIiwiZG9tYWlucy5jcmVhdGUiLCJkb21haW5zLnJlYWQiLCJkb21haW5zLnJlYWQuaG9zdG5hbWUiLCJkb21haW5zLnJlYWQub25lIiwiZG9tYWlucy51cGRhdGUiLCJkb21haW5zLmRlbGV0ZSIsImRvbWFpbnMuZHVwbGljYXRlIiwiZG9tYWlucy5yZWFkLm9yZ2FuaXphdGlvbiIsImRvbWFpbnMucmVhZC5zdG9yZSIsImRvbWFpbnMudmFsaWRhdGUiLCJkb21haW5zLnZlcmlmeSIsImRvbWFpbnMucmVzb2x2ZSIsImRvbWFpbnMuY2hlY2siLCJ0YXhlcy5jcmVhdGUiLCJ0YXhlcy5yZWFkIiwidGF4ZXMucmVhZC5vbmUiLCJ0YXhlcy51cGRhdGUiLCJ0YXhlcy5kZWxldGUiLCJhdWRpdC5sb2dzIiwiYXVkaXQuc3RhdHMiLCJzZWN1cml0eS5sb2dzLmZhaWxlZCIsInNlY3VyaXR5LmxvZ3MubG9ja3MiLCJzZWN1cml0eS5sb2dzLnBhc3N3b3JkIiwic2VjdXJpdHkubG9ncy5zdXNwaWNpb3VzIiwic2VjdXJpdHkuc3VtbWFyeSIsInJhdGUubGltaXRpbmcuc3RhdHVzIiwicmF0ZS5saW1pdGluZy5hdHRlbXB0cyIsInJhdGUubGltaXRpbmcucmVzZXQiLCJyYXRlLmxpbWl0aW5nLmNvbmZpZyIsInJhdGUubGltaXRpbmcudW5ibG9jayIsImVtYWlsLmNvbmZpZyIsImVtYWlsLnRlc3QiLCJlbWFpbC50ZXN0LnRlbXBsYXRlIiwiZW1haWwuc3dpdGNoLnByb3ZpZGVyIiwic3lzdGVtLmhlYWx0aCIsInN5c3RlbS50ZXN0Il0sIm9yZ2FuaXphdGlvbl9pZCI6MTYsInN0b3JlX2lkIjozMSwiaWF0IjoxNzYzMDA4ODMyLCJleHAiOjE3NjMwNDQ4MzJ9.Tt1eJWkH7KJUETXX0Y-mq-l1V-w8962l48ooGh5Bt4w';

async function testProductCreation() {
  try {
    console.log('🧪 Testing product creation fix...\n');

    // Product data
    const productData = {
      name: 'Test Product for Fix',
      description: 'This is a test product to verify the fix for product creation',
      base_price: 99.99,
      sku: 'TEST-FIX-' + Date.now(),
      store_id: 31, // Your store ID from the token
      brand_id: null, // No brand for now
      category_id: null, // No category for now
      stock_quantity: 10,
      state: 'active'
    };

    console.log('📝 Creating product with data:');
    console.log(JSON.stringify(productData, null, 2));
    console.log();

    // Make the request
    const response = await axios.post(`${API_URL}/products`, productData, {
      headers: {
        'Authorization': `Bearer ${AUTH_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ SUCCESS! Product created successfully.');
    console.log('Response status:', response.status);
    console.log('Product data:');
    console.log(JSON.stringify(response.data, null, 2));

  } catch (error) {
    console.log('❌ FAILED! Product creation failed.');

    if (error.response) {
      console.log('Status:', error.response.status);
      console.log('Status Text:', error.response.statusText);
      console.log('Error Response:');
      console.log(JSON.stringify(error.response.data, null, 2));
    } else {
      console.log('Error:', error.message);
    }
  }
}

// Run the test
testProductCreation();