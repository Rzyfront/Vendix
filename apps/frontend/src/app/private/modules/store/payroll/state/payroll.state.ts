import {
  Employee,
  PayrollRun,
  EmployeeStats,
  PayrollStats,
} from '../interfaces/payroll.interface';

export interface PayrollState {
  // Employees
  employees: Employee[];
  employeesLoading: boolean;
  currentEmployee: Employee | null;
  currentEmployeeLoading: boolean;
  employeeMeta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  } | null;
  employeeStats: EmployeeStats | null;
  employeeStatsLoading: boolean;

  // Payroll Runs
  payrollRuns: PayrollRun[];
  payrollRunsLoading: boolean;
  currentPayrollRun: PayrollRun | null;
  currentPayrollRunLoading: boolean;
  payrollRunMeta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  } | null;
  payrollRunStats: PayrollStats | null;
  payrollRunStatsLoading: boolean;

  // Shared
  error: string | null;

  // Employee filters
  employeeSearch: string;
  employeePage: number;
  employeeLimit: number;
  employeeSortBy: string;
  employeeSortOrder: 'asc' | 'desc';
  employeeStatusFilter: string;
  employeeDepartmentFilter: string;

  // Payroll Run filters
  payrollRunSearch: string;
  payrollRunPage: number;
  payrollRunLimit: number;
  payrollRunSortBy: string;
  payrollRunSortOrder: 'asc' | 'desc';
  payrollRunStatusFilter: string;
  payrollRunFrequencyFilter: string;
  payrollRunDateFrom: string;
  payrollRunDateTo: string;
}

export const initialPayrollState: PayrollState = {
  // Employees
  employees: [],
  employeesLoading: false,
  currentEmployee: null,
  currentEmployeeLoading: false,
  employeeMeta: null,
  employeeStats: null,
  employeeStatsLoading: false,

  // Payroll Runs
  payrollRuns: [],
  payrollRunsLoading: false,
  currentPayrollRun: null,
  currentPayrollRunLoading: false,
  payrollRunMeta: null,
  payrollRunStats: null,
  payrollRunStatsLoading: false,

  // Shared
  error: null,

  // Employee filters
  employeeSearch: '',
  employeePage: 1,
  employeeLimit: 10,
  employeeSortBy: 'created_at',
  employeeSortOrder: 'desc',
  employeeStatusFilter: '',
  employeeDepartmentFilter: '',

  // Payroll Run filters
  payrollRunSearch: '',
  payrollRunPage: 1,
  payrollRunLimit: 10,
  payrollRunSortBy: 'created_at',
  payrollRunSortOrder: 'desc',
  payrollRunStatusFilter: '',
  payrollRunFrequencyFilter: '',
  payrollRunDateFrom: '',
  payrollRunDateTo: '',
};
