import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'vendix-expense-reports',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="expense-reports">
      <h2>Expense Reports</h2>
      <p>Expense reports and analytics will be displayed here.</p>
    </div>
  `,
  styles: [
    `
      .expense-reports {
        padding: 20px;
      }
    `,
  ],
})
export class ExpenseReportsComponent {}
