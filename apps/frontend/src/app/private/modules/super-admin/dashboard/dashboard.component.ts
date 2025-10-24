import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-super-admin-dashboard',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="space-y-6">
      <!-- Stats Cards -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
        <div class="bg-white rounded-lg shadow-sm p-6 border" style="border-color: var(--border);">
          <div class="flex items-center justify-between mb-4">
            <div class="w-12 h-12 rounded-lg flex items-center justify-center" style="background-color: rgba(126, 215, 165, 0.2);">
              <i class="fas fa-building text-xl" style="color: var(--primary);"></i>
            </div>
            <span class="text-sm font-medium" style="color: var(--secondary);">+5%</span>
          </div>
          <h3 class="text-sm font-medium" style="color: var(--secondary);">Total Organizations</h3>
          <p class="text-3xl font-bold mt-2" style="color: var(--text);">24</p>
        </div>
        
        <div class="bg-white rounded-lg shadow-sm p-6 border" style="border-color: var(--border);">
          <div class="flex items-center justify-between mb-4">
            <div class="w-12 h-12 rounded-lg flex items-center justify-center" style="background-color: rgba(126, 215, 165, 0.2);">
              <i class="fas fa-users text-xl" style="color: var(--primary);"></i>
            </div>
            <span class="text-sm font-medium" style="color: var(--secondary);">+12%</span>
          </div>
          <h3 class="text-sm font-medium" style="color: var(--secondary);">Total Users</h3>
          <p class="text-3xl font-bold mt-2" style="color: var(--text);">1,543</p>
        </div>
        
        <div class="bg-white rounded-lg shadow-sm p-6 border" style="border-color: var(--border);">
          <div class="flex items-center justify-between mb-4">
            <div class="w-12 h-12 rounded-lg flex items-center justify-center" style="background-color: rgba(126, 215, 165, 0.2);">
              <i class="fas fa-store text-xl" style="color: var(--primary);"></i>
            </div>
            <span class="text-sm font-medium text-red-600">-2%</span>
          </div>
          <h3 class="text-sm font-medium" style="color: var(--secondary);">Active Stores</h3>
          <p class="text-3xl font-bold mt-2" style="color: var(--text);">156</p>
        </div>
        
        <div class="bg-white rounded-lg shadow-sm p-6 border" style="border-color: var(--border);">
          <div class="flex items-center justify-between mb-4">
            <div class="w-12 h-12 rounded-lg flex items-center justify-center" style="background-color: rgba(126, 215, 165, 0.2);">
              <i class="fas fa-chart-line text-xl" style="color: var(--primary);"></i>
            </div>
            <span class="text-sm font-medium" style="color: var(--secondary);">+8%</span>
          </div>
          <h3 class="text-sm font-medium" style="color: var(--secondary);">Platform Growth</h3>
          <p class="text-3xl font-bold mt-2" style="color: var(--text);">18.2%</p>
        </div>
      </div>
      
      <!-- Recent Activity -->
      <div class="bg-white rounded-lg shadow-sm border" style="border-color: var(--border);">
        <div class="px-6 py-4 border-b" style="border-color: var(--border);">
          <h2 class="text-lg font-semibold" style="color: var(--text);">Platform Overview</h2>
        </div>
        <div class="p-6">
          <div class="space-y-4">
            <div class="flex items-start gap-4">
              <div class="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style="background-color: rgba(126, 215, 165, 0.2);">
                <i class="fas fa-building" style="color: var(--primary);"></i>
              </div>
              <div class="flex-1">
                <p class="text-sm font-medium" style="color: var(--text);">New organization registered</p>
                <p class="text-sm" style="color: var(--secondary);">TechCorp Inc joined the platform</p>
                <p class="text-xs text-gray-400 mt-1">30 minutes ago</p>
              </div>
            </div>
            
            <div class="flex items-start gap-4">
              <div class="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style="background-color: rgba(126, 215, 165, 0.2);">
                <i class="fas fa-check" style="color: var(--primary);"></i>
              </div>
              <div class="flex-1">
                <p class="text-sm font-medium" style="color: var(--text);">System update completed</p>
                <p class="text-sm" style="color: var(--secondary);">Platform v2.1.0 deployed successfully</p>
                <p class="text-xs text-gray-400 mt-1">2 hours ago</p>
              </div>
            </div>
            
            <div class="flex items-start gap-4">
              <div class="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style="background-color: rgba(126, 215, 165, 0.2);">
                <i class="fas fa-user-plus" style="color: var(--primary);"></i>
              </div>
              <div class="flex-1">
                <p class="text-sm font-medium" style="color: var(--text);">New super admin added</p>
                <p class="text-sm" style="color: var(--secondary);">Sarah Wilson granted super admin access</p>
                <p class="text-xs text-gray-400 mt-1">4 hours ago</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `
})
export class DashboardComponent { }