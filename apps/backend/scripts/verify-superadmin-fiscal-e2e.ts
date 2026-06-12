/* eslint-disable no-console */
/**
 * E2E verification script for the VENDIX_ADMIN Módulo Fiscal.
 *
 * Exercises the critical cycle:
 *   1. Login as super-admin (admin@vendix.online)
 *   2. Verify platform org is bootstrapped
 *   3. GET /super-admin/fiscal/accounting/chart-of-accounts (returns platform org PUC)
 *   4. GET /super-admin/fiscal/accounting/fiscal-periods (returns open period)
 *   5. GET /super-admin/fiscal/accounting/account-mappings?prefix=saas_ (returns 11 SaaS keys)
 *   6. POST /super-admin/fiscal/accounting/journal-entries (creates manual entry)
 *   7. GET /super-admin/fiscal/accounting/journal-entries (verifies the new entry appears)
 *   8. GET /super-admin/fiscal/accounting/reports/trial-balance (returns balanced DR/CR)
 *   9. GET /super-admin/fiscal/obligations?period=YYYY-MM (returns current period obligations)
 *
 * Run from `apps/backend`:
 *   npx tsx scripts/verify-superadmin-fiscal-e2e.ts
 */
import * as http from 'http';

const BASE_URL = process.env.BACKEND_URL || 'http://localhost:3000';
const API_PREFIX = process.env.API_PREFIX || 'api';
const SUPER_ADMIN_EMAIL = 'admin@vendix.online';
const SUPER_ADMIN_PASSWORD = '1125634q';

interface LoginResponse {
  data: {
    access_token: string;
    user: { id: number; email: string; roles: string[] };
  };
}

interface ApiResponse<T> {
  data: T;
  meta?: { total: number; page: number; limit: number };
  message?: string;
}

function request<T = any>(
  method: string,
  path: string,
  body?: any,
  token?: string,
): Promise<{ status: number; body: ApiResponse<T> }> {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE_URL + path);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          try {
            const body = JSON.parse(text);
            resolve({ status: res.statusCode ?? 0, body });
          } catch (e) {
            reject(new Error(`Non-JSON response: ${text.slice(0, 200)}`));
          }
        });
      },
    );
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function ok(label: string, cond: boolean, extra?: string) {
  if (cond) {
    console.log(`  ✓ ${label}${extra ? ` (${extra})` : ''}`);
  } else {
    console.error(`  ✗ ${label}${extra ? ` (${extra})` : ''}`);
    process.exitCode = 1;
  }
}

async function main() {
  console.log('=== VENDIX_ADMIN Módulo Fiscal — E2E Verification ===\n');

  // 1. Login
  console.log('1. Login as super-admin');
  const loginRes = await request<LoginResponse['data']>(
    'POST',
    `/${API_PREFIX}/auth/login`,
    {
      email: SUPER_ADMIN_EMAIL,
      password: SUPER_ADMIN_PASSWORD,
      organization_slug: 'vendix',
    },
  );
  ok('POST /auth/login', loginRes.status === 200, `status=${loginRes.status}`);
  const token = loginRes.body?.data?.access_token;
  if (!token) {
    console.error('No access token returned. Aborting.');
    process.exit(1);
  }
  ok('Token present', !!token);

  // 2. Verify platform org via settings (settings_sync or via the chart-of-accounts endpoint)
  console.log('\n2. Verify platform org is bootstrapped');
  const coaRes = await request<any[]>(
    'GET',
    `/${API_PREFIX}/super-admin/fiscal/accounting/chart-of-accounts?limit=1`,
    undefined,
    token,
  );
  ok('GET /super-admin/fiscal/accounting/chart-of-accounts', coaRes.status === 200, `status=${coaRes.status}`);
  ok('COA has at least 1 account', Array.isArray(coaRes.body?.data) && coaRes.body.data.length > 0, `count=${coaRes.body?.data?.length ?? 0}`);

  // 3. Fiscal periods
  console.log('\n3. Get fiscal periods');
  const periodsRes = await request<any[]>(
    'GET',
    `/${API_PREFIX}/super-admin/fiscal/accounting/fiscal-periods`,
    undefined,
    token,
  );
  ok('GET /super-admin/fiscal/accounting/fiscal-periods', periodsRes.status === 200, `status=${periodsRes.status}`);
  const openPeriods = (periodsRes.body?.data ?? []).filter((p: any) => p.status === 'open');
  ok('At least 1 open fiscal period', openPeriods.length >= 1, `count=${openPeriods.length}`);

  // 4. Account mappings
  console.log('\n4. Get SaaS account mappings');
  const mappingsRes = await request<any[]>(
    'GET',
    `/${API_PREFIX}/super-admin/fiscal/accounting/account-mappings?prefix=saas_`,
    undefined,
    token,
  );
  ok('GET /super-admin/fiscal/accounting/account-mappings?prefix=saas_', mappingsRes.status === 200, `status=${mappingsRes.status}`);
  const saasKeys = mappingsRes.body?.data ?? [];
  ok('At least 11 SaaS mapping keys (5 existing + 6 new)', saasKeys.length >= 11, `count=${saasKeys.length}`);

  // 5. Create manual journal entry
  console.log('\n5. Create manual journal entry');
  if (openPeriods.length === 0) {
    console.error('  ! No open fiscal period — cannot create journal entry');
    process.exitCode = 1;
  } else {
    const period = openPeriods[0];

    // Resolve account codes to account_ids (the DTO requires numeric ids)
    // Note: parent accounts (1110, 5195) don't accept entries — must use subaccounts
    // or accounts where accepts_entries=true.
    const coaSearch = await request<any[]>(
      'GET',
      `/${API_PREFIX}/super-admin/fiscal/accounting/chart-of-accounts?limit=1000`,
      undefined,
      token,
    );
    const coaRows = (coaSearch.body?.data ?? []).filter(
      (a: any) => a.accepts_entries === true,
    );
    // Find a 'gasto' (expense) and a 'banco' (asset) that accept entries
    const accExpense = coaRows.find(
      (a: any) => a.account_type === 'expense' && a.code.startsWith('51'),
    );
    const accAsset = coaRows.find(
      (a: any) => a.account_type === 'asset' && a.code.startsWith('11'),
    );
    if (!accExpense || !accAsset) {
      console.error(
        `  ! Cannot find required accounts (expense+asset with accepts_entries=true); got ${coaRows.length} leaf accounts`,
      );
      process.exitCode = 1;
    } else {
      const today = new Date().toISOString().slice(0, 10);
      const newEntry = await request<any>(
        'POST',
        `/${API_PREFIX}/super-admin/fiscal/accounting/journal-entries`,
        {
          fiscal_period_id: period.id,
          entry_date: today,
          description: 'E2E Test — Gasto menor',
          lines: [
            { account_id: accExpense.id, description: 'Gasto prueba', debit_amount: 100000, credit_amount: 0 },
            { account_id: accAsset.id, description: 'Caja/Banco', debit_amount: 0, credit_amount: 100000 },
          ],
        },
        token,
      );
      ok('POST /super-admin/fiscal/accounting/journal-entries', newEntry.status === 201, `status=${newEntry.status} body=${JSON.stringify(newEntry.body).slice(0, 200)}`);
      const entryNumber = newEntry.body?.data?.entry_number;
      ok('Entry number is AE-YYYY-NNNNNN format', /^AE-\d{4}-\d{6}$/.test(entryNumber ?? ''), `entry_number=${entryNumber}`);

      // 6. Verify entry appears in list
      console.log('\n6. Verify entry appears in journal-entries list');
      const listRes = await request<any>(
        'GET',
        `/${API_PREFIX}/super-admin/fiscal/accounting/journal-entries?fiscal_period_id=${period.id}&limit=5`,
        undefined,
        token,
      );
      ok('GET /super-admin/fiscal/accounting/journal-entries (manual)', listRes.status === 200, `status=${listRes.status}`);
      const found = (listRes.body?.data ?? []).some((e: any) => e.entry_number === entryNumber);
      ok('Created entry appears in list', found);
    }
  }

  // 7. Trial balance report
  console.log('\n7. Get trial balance');
  const year = new Date().getUTCFullYear();
  const tbRes = await request<any[]>(
    'GET',
    `/${API_PREFIX}/super-admin/fiscal/accounting/reports/trial-balance?from=${year}-01-01&to=${year}-12-31`,
    undefined,
    token,
  );
  ok('GET /super-admin/fiscal/accounting/reports/trial-balance', tbRes.status === 200, `status=${tbRes.status}`);
  if (Array.isArray(tbRes.body?.data?.accounts) && tbRes.body.data.accounts.length > 0) {
    const accounts = tbRes.body.data.accounts;
    const totalDebit = accounts.reduce(
      (sum: number, r: any) => sum + Number(r.total_debit ?? 0),
      0,
    );
    const totalCredit = accounts.reduce(
      (sum: number, r: any) => sum + Number(r.total_credit ?? 0),
      0,
    );
    ok(
      `Trial balance has data rows (count=${accounts.length})`,
      accounts.length > 0,
    );
    ok(
      'Trial balance DR = CR within 0.001',
      Math.abs(totalDebit - totalCredit) < 0.001,
      `DR=${totalDebit.toFixed(2)} CR=${totalCredit.toFixed(2)}`,
    );
  } else {
    ok('Trial balance has data rows', false, 'empty');
  }

  // 8. Obligations
  console.log('\n8. Get fiscal obligations for current period');
  const now = new Date();
  const periodYear = now.getUTCFullYear();
  const periodMonth = now.getUTCMonth() + 1;
  const oblRes = await request<any[]>(
    'GET',
    `/${API_PREFIX}/super-admin/fiscal/obligations?period_year=${periodYear}&period_month=${periodMonth}&limit=5`,
    undefined,
    token,
  );
  ok('GET /super-admin/fiscal/obligations', oblRes.status === 200, `status=${oblRes.status}`);

  // 9. Sidecar — vendor support documents list
  console.log('\n9. Get vendor support documents (inbound invoicing)');
  const vsdRes = await request<any[]>(
    'GET',
    `/${API_PREFIX}/super-admin/fiscal/invoicing/inbound?limit=5`,
    undefined,
    token,
  );
  ok('GET /super-admin/fiscal/invoicing/inbound', vsdRes.status === 200, `status=${vsdRes.status}`);

  console.log('\n=== Verification complete ===');
  if (process.exitCode === 1) {
    console.error('\n❌ Some checks failed');
  } else {
    console.log('\n✅ All checks passed');
  }
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
