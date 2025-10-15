import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-organizations',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="space-y-6">
      <div class="flex justify-between items-center">
        <h1 class="text-2xl font-bold" style="color: var(--text);">Organizations Management</h1>
        <button class="px-4 py-2 rounded-lg text-white font-medium" style="background-color: var(--primary);">
          <i class="fas fa-plus mr-2"></i>
          Add Organization
        </button>
      </div>

      <!-- Organizations List -->
      <div class="bg-white rounded-lg shadow-sm border" style="border-color: var(--border);">
        <div class="px-6 py-4 border-b" style="border-color: var(--border);">
          <h2 class="text-lg font-semibold" style="color: var(--text);">All Organizations</h2>
        </div>
        <div class="p-6">
          <div class="space-y-4">
            <div class="flex items-center justify-between p-4 border rounded-lg" style="border-color: var(--border);">
              <div class="flex items-center gap-4">
                <div class="w-12 h-12 rounded-lg flex items-center justify-center" style="background-color: rgba(126, 215, 165, 0.2);">
                  <i class="fas fa-building" style="color: var(--primary);"></i>
                </div>
                <div>
                  <h3 class="font-semibold" style="color: var(--text);">TechCorp Inc</h3>
                  <p class="text-sm" style="color: var(--secondary);">5 stores • 120 users</p>
                </div>
              </div>
              <div class="flex items-center gap-2">
                <span class="px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">Active</span>
                <button class="p-2 rounded-lg hover:bg-gray-50">
                  <i class="fas fa-ellipsis-v" style="color: var(--text);"></i>
                </button>
              </div>
            </div>

            <div class="flex items-center justify-between p-4 border rounded-lg" style="border-color: var(--border);">
              <div class="flex items-center gap-4">
                <div class="w-12 h-12 rounded-lg flex items-center justify-center" style="background-color: rgba(126, 215, 165, 0.2);">
                  <i class="fas fa-building" style="color: var(--primary);"></i>
                </div>
                <div>
                  <h3 class="font-semibold" style="color: var(--text);">Retail Solutions</h3>
                  <p class="text-sm" style="color: var(--secondary);">3 stores • 85 users</p>
                </div>
              </div>
              <div class="flex items-center gap-2">
                <span class="px-3 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">Pending</span>
                <button class="p-2 rounded-lg hover:bg-gray-50">
                  <i class="fas fa-ellipsis-v" style="color: var(--text);"></i>
                </button>
              </div>
            </div>

            <div class="flex items-center justify-between p-4 border rounded-lg" style="border-color: var(--border);">
              <div class="flex items-center gap-4">
                <div class="w-12 h-12 rounded-lg flex items-center justify-center" style="background-color: rgba(126, 215, 165, 0.2);">
                  <i class="fas fa-building" style="color: var(--primary);"></i>
                </div>
                <div>
                  <h3 class="font-semibold" style="color: var(--text);">Global Commerce</h3>
                  <p class="text-sm" style="color: var(--secondary);">8 stores • 210 users</p>
                </div>
              </div>
              <div class="flex items-center gap-2">
                <span class="px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">Active</span>
                <button class="p-2 rounded-lg hover:bg-gray-50">
                  <i class="fas fa-ellipsis-v" style="color: var(--text);"></i>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `
})
export class OrganizationsComponent {}