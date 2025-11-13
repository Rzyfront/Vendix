import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-stores-management',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="p-6">
      <h1 class="text-2xl font-bold mb-6">Store Management</h1>

      <!-- Actions Bar -->
      <div class="bg-white rounded-lg shadow p-4 mb-6">
        <div class="flex justify-between items-center">
          <div class="flex space-x-4">
            <button
              class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Create New Store
            </button>
            <button
              class="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
            >
              Import Stores
            </button>
          </div>
          <div class="flex space-x-2">
            <input
              type="text"
              placeholder="Search stores..."
              class="px-4 py-2 border rounded"
            />
            <select class="px-4 py-2 border rounded">
              <option>All Status</option>
              <option>Active</option>
              <option>Inactive</option>
              <option>Maintenance</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Stores Grid -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <!-- Store Card Placeholder -->
        <div class="bg-white rounded-lg shadow p-6">
          <div class="flex justify-between items-start mb-4">
            <h3 class="text-lg font-semibold">Store Name</h3>
            <span class="px-2 py-1 bg-green-100 text-green-800 text-xs rounded"
              >Active</span
            >
          </div>
          <p class="text-gray-600 mb-4">Store description goes here</p>
          <div class="space-y-2 text-sm">
            <div class="flex justify-between">
              <span class="text-gray-500">Type:</span>
              <span>Online</span>
            </div>
            <div class="flex justify-between">
              <span class="text-gray-500">Products:</span>
              <span>0</span>
            </div>
            <div class="flex justify-between">
              <span class="text-gray-500">Revenue:</span>
              <span>$0</span>
            </div>
          </div>
          <div class="mt-4 flex space-x-2">
            <button
              class="flex-1 px-3 py-1 bg-blue-50 text-blue-600 rounded text-sm hover:bg-blue-100"
            >
              Configure
            </button>
            <button
              class="flex-1 px-3 py-1 border border-gray-300 rounded text-sm hover:bg-gray-50"
            >
              View Details
            </button>
          </div>
        </div>

        <!-- Empty State -->
        <div class="col-span-full bg-white rounded-lg shadow p-12 text-center">
          <div class="text-gray-400 mb-4">
            <svg
              class="w-16 h-16 mx-auto"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
              ></path>
            </svg>
          </div>
          <h3 class="text-lg font-medium text-gray-900 mb-2">
            No stores found
          </h3>
          <p class="text-gray-500 mb-4">
            Get started by creating your first store
          </p>
          <button
            class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Create Store
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class StoresManagementComponent {}
