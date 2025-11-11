import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-store-dashboard',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="space-y-6">
      <!-- Stats Cards -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
        <div class="bg-white rounded-lg shadow-sm p-6 border" style="border-color: var(--border);">
          <div class="flex items-center justify-between mb-4">
            <div class="w-12 h-12 rounded-lg flex items-center justify-center" style="background-color: rgba(126, 215, 165, 0.2);">
              <i class="fas fa-shopping-cart text-xl" style="color: var(--primary);"></i>
            </div>
            <span class="text-sm font-medium" style="color: var(--secondary);">+12%</span>
          </div>
          <h3 class="text-sm font-medium" style="color: var(--secondary);">Today's Orders</h3>
          <p class="text-3xl font-bold mt-2" style="color: var(--text);">47</p>
        </div>
        
        <div class="bg-white rounded-lg shadow-sm p-6 border" style="border-color: var(--border);">
          <div class="flex items-center justify-between mb-4">
            <div class="w-12 h-12 rounded-lg flex items-center justify-center" style="background-color: rgba(126, 215, 165, 0.2);">
              <i class="fas fa-dollar-sign text-xl" style="color: var(--primary);"></i>
            </div>
            <span class="text-sm font-medium" style="color: var(--secondary);">+8%</span>
          </div>
          <h3 class="text-sm font-medium" style="color: var(--secondary);">Daily Revenue</h3>
          <p class="text-3xl font-bold mt-2" style="color: var(--text);">$2,847</p>
        </div>
        
        <div class="bg-white rounded-lg shadow-sm p-6 border" style="border-color: var(--border);">
          <div class="flex items-center justify-between mb-4">
            <div class="w-12 h-12 rounded-lg flex items-center justify-center" style="background-color: rgba(126, 215, 165, 0.2);">
              <i class="fas fa-users text-xl" style="color: var(--primary);"></i>
            </div>
            <span class="text-sm font-medium" style="color: var(--secondary);">+5%</span>
          </div>
          <h3 class="text-sm font-medium" style="color: var(--secondary);">Store Visitors</h3>
          <p class="text-3xl font-bold mt-2" style="color: var(--text);">324</p>
        </div>
        
        <div class="bg-white rounded-lg shadow-sm p-6 border" style="border-color: var(--border);">
          <div class="flex items-center justify-between mb-4">
            <div class="w-12 h-12 rounded-lg flex items-center justify-center" style="background-color: rgba(126, 215, 165, 0.2);">
              <i class="fas fa-star text-xl" style="color: var(--primary);"></i>
            </div>
            <span class="text-sm font-medium" style="color: var(--secondary);">+3%</span>
          </div>
          <h3 class="text-sm font-medium" style="color: var(--secondary);">Average Rating</h3>
          <p class="text-3xl font-bold mt-2" style="color: var(--text);">4.7</p>
        </div>
      </div>
      
      <!-- Recent Activity -->
      <div class="bg-white rounded-lg shadow-sm border" style="border-color: var(--border);">
        <div class="px-6 py-4 border-b" style="border-color: var(--border);">
          <h2 class="text-lg font-semibold" style="color: var(--text);">Store Activity</h2>
        </div>
        <div class="p-6">
          <div class="space-y-4">
            <div class="flex items-start gap-4">
              <div class="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style="background-color: rgba(126, 215, 165, 0.2);">
                <i class="fas fa-shopping-cart" style="color: var(--primary);"></i>
              </div>
              <div class="flex-1">
                <p class="text-sm font-medium" style="color: var(--text);">New order received</p>
                <p class="text-sm" style="color: var(--secondary);">Order #1234 from John Smith</p>
                <p class="text-xs text-gray-400 mt-1">15 minutes ago</p>
              </div>
            </div>
            
            <div class="flex items-start gap-4">
              <div class="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style="background-color: rgba(126, 215, 165, 0.2);">
                <i class="fas fa-box" style="color: var(--primary);"></i>
              </div>
              <div class="flex-1">
                <p class="text-sm font-medium" style="color: var(--text);">Product restocked</p>
                <p class="text-sm" style="color: var(--secondary);">Premium Headphones inventory updated</p>
                <p class="text-xs text-gray-400 mt-1">1 hour ago</p>
              </div>
            </div>
            
            <div class="flex items-start gap-4">
              <div class="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style="background-color: rgba(126, 215, 165, 0.2);">
                <i class="fas fa-star" style="color: var(--primary);"></i>
              </div>
              <div class="flex-1">
                <p class="text-sm font-medium" style="color: var(--text);">New review received</p>
                <p class="text-sm" style="color: var(--secondary);">5-star rating from Sarah Johnson</p>
                <p class="text-xs text-gray-400 mt-1">3 hours ago</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `
})
export class DashboardComponent {}