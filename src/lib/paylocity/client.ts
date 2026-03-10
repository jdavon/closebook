/**
 * Paylocity API Client
 *
 * Typed fetch-based client for both NextGen and WebLink Paylocity APIs.
 * Handles OAuth2 Client Credentials authentication, token caching, and pagination.
 *
 * NextGen API (dc1prodgwext.paylocity.com):
 *   - Employee Demographics, Earnings, Deductions
 *   - Punch Details, Shifts/Schedules
 *   - Job Codes, Cost Centers
 *
 * WebLink API (api.paylocity.com):
 *   - Pay Statements (summary + details)
 *   - Local Taxes
 *
 * Usage:
 *   const client = new PaylocityClient();
 *   const employees = await client.getEmployees();
 *   const payStatements = await client.getPayStatementSummary('12345', 2026);
 */

import type {
  TokenResponse,
  Employee,
  EmployeeBatchResponse,
  EmployeeEarning,
  EmployeeDeduction,
  EarningCode,
  DeductionCode,
  JobCode,
  CostCenterLevel,
  PunchDetail,
  EmployeeShift,
  PayStatementSummary,
  PayStatementDetail,
  LocalTax,
} from "./types";

// ─── Configuration ───────────────────────────────────────────────────

interface PaylocityConfig {
  ng: {
    clientId: string;
    clientSecret: string;
    authUrl: string;
    baseUrl: string;
  };
  wl: {
    clientId: string;
    clientSecret: string;
    authUrl: string;
    baseUrl: string;
  };
  companyId: string;
}

function getConfig(companyId?: string): PaylocityConfig {
  const required = (key: string): string => {
    const val = process.env[key];
    if (!val) throw new Error(`Missing env var: ${key}`);
    return val;
  };

  return {
    ng: {
      clientId: required("PAYLOCITY_NG_CLIENT_ID"),
      clientSecret: required("PAYLOCITY_NG_CLIENT_SECRET"),
      authUrl:
        process.env.PAYLOCITY_NG_AUTH_URL ||
        "https://dc1prodgwext.paylocity.com/public/security/v1/token",
      baseUrl:
        process.env.PAYLOCITY_NG_BASE_URL ||
        "https://dc1prodgwext.paylocity.com",
    },
    wl: {
      clientId: required("PAYLOCITY_WL_CLIENT_ID"),
      clientSecret: required("PAYLOCITY_WL_CLIENT_SECRET"),
      authUrl:
        process.env.PAYLOCITY_WL_AUTH_URL ||
        "https://api.paylocity.com/IdentityServer/connect/token",
      baseUrl:
        process.env.PAYLOCITY_WL_BASE_URL ||
        "https://api.paylocity.com/api/v2",
    },
    companyId: companyId ?? required("PAYLOCITY_COMPANY_ID"),
  };
}

/**
 * Get all configured Paylocity company IDs.
 * Reads from PAYLOCITY_COMPANY_IDS (comma-separated) with PAYLOCITY_COMPANY_ID as fallback.
 */
export function getCompanyIds(): string[] {
  const multi = process.env.PAYLOCITY_COMPANY_IDS;
  if (multi) {
    return multi.split(",").map((s) => s.trim()).filter(Boolean);
  }
  const single = process.env.PAYLOCITY_COMPANY_ID;
  if (single) return [single];
  throw new Error("Missing env var: PAYLOCITY_COMPANY_IDS or PAYLOCITY_COMPANY_ID");
}

/**
 * Create a PaylocityClient for each configured company.
 * Useful for fetching data across all companies and merging results.
 */
export function getAllCompanyClients(): PaylocityClient[] {
  return getCompanyIds().map((id) => new PaylocityClient({ companyId: id }));
}

// ─── Token Cache ─────────────────────────────────────────────────────

interface CachedToken {
  accessToken: string;
  expiresAt: number; // unix ms
}

const tokenCache: { ng?: CachedToken; wl?: CachedToken } = {};

// ─── Client ──────────────────────────────────────────────────────────

export class PaylocityClient {
  private config: PaylocityConfig;

  constructor(config?: Partial<PaylocityConfig>) {
    const base = getConfig(config?.companyId);
    this.config = config
      ? { ...base, ...config }
      : base;
  }

  get companyId() {
    return this.config.companyId;
  }

  // ─── Authentication ──────────────────────────────────────────────

  /** Get a NextGen API access token (cached, auto-refreshes) */
  private async getNgToken(): Promise<string> {
    if (tokenCache.ng && Date.now() < tokenCache.ng.expiresAt - 60_000) {
      return tokenCache.ng.accessToken;
    }

    const res = await fetch(this.config.ng.authUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: this.config.ng.clientId,
        client_secret: this.config.ng.clientSecret,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`NextGen auth failed (${res.status}): ${text}`);
    }

    const data: TokenResponse = await res.json();
    tokenCache.ng = {
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
    return data.access_token;
  }

  /** Get a WebLink API access token (cached, auto-refreshes) */
  private async getWlToken(): Promise<string> {
    if (tokenCache.wl && Date.now() < tokenCache.wl.expiresAt - 60_000) {
      return tokenCache.wl.accessToken;
    }

    const res = await fetch(this.config.wl.authUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        scope: "WebLinkAPI",
        client_id: this.config.wl.clientId,
        client_secret: this.config.wl.clientSecret,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`WebLink auth failed (${res.status}): ${text}`);
    }

    const data: TokenResponse = await res.json();
    tokenCache.wl = {
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
    return data.access_token;
  }

  /** Test both API connections. Returns status for each. */
  async testConnections(): Promise<{
    nextGen: { ok: boolean; error?: string };
    webLink: { ok: boolean; error?: string };
  }> {
    const results = {
      nextGen: { ok: false, error: undefined as string | undefined },
      webLink: { ok: false, error: undefined as string | undefined },
    };

    try {
      await this.getNgToken();
      results.nextGen.ok = true;
    } catch (e) {
      results.nextGen.error =
        e instanceof Error ? e.message : "Unknown error";
    }

    try {
      await this.getWlToken();
      results.webLink.ok = true;
    } catch (e) {
      results.webLink.error =
        e instanceof Error ? e.message : "Unknown error";
    }

    return results;
  }

  // ─── Generic Fetch Helpers ───────────────────────────────────────

  private async ngFetch<T>(path: string, params?: Record<string, string>): Promise<T> {
    const token = await this.getNgToken();
    const url = new URL(path, this.config.ng.baseUrl);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
      }
    }

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`NextGen API ${path} failed (${res.status}): ${text}`);
    }

    return res.json();
  }

  private async wlFetch<T>(
    path: string,
    params?: Record<string, string>,
    opts?: { emptyOn404?: boolean; retries?: number }
  ): Promise<T> {
    const maxRetries = opts?.retries ?? 2;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const token = await this.getWlToken();
      const url = `${this.config.wl.baseUrl}${path}`;
      const fullUrl = new URL(url);
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          fullUrl.searchParams.set(k, v);
        }
      }

      const res = await fetch(fullUrl.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });

      // 404 = no data for this resource — return empty array if opted in
      if (res.status === 404 && opts?.emptyOn404) {
        return [] as unknown as T;
      }

      // 429 = rate limited — retry with exponential backoff
      if (res.status === 429 && attempt < maxRetries) {
        const retryAfter = res.headers.get("Retry-After");
        const waitMs = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : 1000 * Math.pow(2, attempt); // 1s, 2s, 4s
        console.warn(
          `[Paylocity] Rate limited on ${path}, retrying in ${waitMs}ms (attempt ${attempt + 1}/${maxRetries})`
        );
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        continue;
      }

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`WebLink API ${path} failed (${res.status}): ${text}`);
      }

      return res.json();
    }

    // Should never reach here, but TypeScript needs it
    throw new Error(`WebLink API ${path} failed after ${maxRetries} retries`);
  }

  // ─── NextGen: Employee Demographics ──────────────────────────────

  /**
   * Get all employees with demographics, pay rates, and position info.
   * Paginates automatically (cursor-based, max 20 per page).
   */
  async getEmployees(opts?: {
    activeOnly?: boolean;
    include?: ("info" | "position" | "status" | "payrate" | "futurePayrates")[];
  }): Promise<Employee[]> {
    const include = opts?.include ?? ["info", "position", "payrate"];
    const allEmployees: Employee[] = [];
    let nextToken: string | undefined;

    do {
      const params: Record<string, string> = {
        include: include.join(","),
        limit: "20",
      };
      if (opts?.activeOnly) params.activeOnly = "true";
      if (nextToken) params.nextToken = nextToken;

      const data = await this.ngFetch<EmployeeBatchResponse & { nextToken?: string }>(
        `/coreHr/v1/companies/${this.config.companyId}/employees`,
        params
      );

      allEmployees.push(...(data.employees || []));
      nextToken = data.nextToken;
    } while (nextToken);

    return allEmployees;
  }

  /** Get a single employee by ID */
  async getEmployee(
    employeeId: string,
    include?: ("info" | "position" | "status" | "payrate" | "futurePayrates")[]
  ): Promise<Employee> {
    const inc = include ?? ["info", "position", "payrate"];
    return this.ngFetch<Employee>(
      `/coreHr/v1/companies/${this.config.companyId}/employees/${employeeId}`,
      { include: inc.join(",") }
    );
  }

  // ─── NextGen: Employee Earnings ──────────────────────────────────

  /** Get all earnings for an employee */
  async getEmployeeEarnings(
    employeeId: string,
    opts?: { limit?: number; offset?: number }
  ): Promise<EmployeeEarning[]> {
    const params: Record<string, string> = {
      limit: String(opts?.limit ?? 250),
      offset: String(opts?.offset ?? 0),
    };
    return this.ngFetch<EmployeeEarning[]>(
      `/apiHub/payroll/v1/companies/${this.config.companyId}/employees/${employeeId}/earnings`,
      params
    );
  }

  /** Get company-level earning codes */
  async getEarningCodes(): Promise<EarningCode[]> {
    const all: EarningCode[] = [];
    let offset = 0;
    const limit = 100;

    while (true) {
      const batch = await this.ngFetch<EarningCode[]>(
        `/apiHub/payroll/v1/companies/${this.config.companyId}/earnings`,
        { limit: String(limit), offset: String(offset), includeTotalCount: "true" }
      );
      all.push(...batch);
      if (batch.length < limit) break;
      offset += limit;
    }

    return all;
  }

  // ─── NextGen: Employee Deductions ────────────────────────────────

  /** Get all deductions for an employee */
  async getEmployeeDeductions(
    employeeId: string,
    opts?: { limit?: number; offset?: number }
  ): Promise<EmployeeDeduction[]> {
    const params: Record<string, string> = {
      limit: String(opts?.limit ?? 250),
      offset: String(opts?.offset ?? 0),
    };
    return this.ngFetch<EmployeeDeduction[]>(
      `/apiHub/payroll/v1/companies/${this.config.companyId}/employees/${employeeId}/deductions`,
      params
    );
  }

  /** Get company-level deduction codes */
  async getDeductionCodes(): Promise<DeductionCode[]> {
    const all: DeductionCode[] = [];
    let offset = 0;
    const limit = 100;

    while (true) {
      const batch = await this.ngFetch<DeductionCode[]>(
        `/apiHub/payroll/v1/companies/${this.config.companyId}/deductions`,
        { limit: String(limit), offset: String(offset), includeTotalCount: "true" }
      );
      all.push(...batch);
      if (batch.length < limit) break;
      offset += limit;
    }

    return all;
  }

  // ─── NextGen: Punch Details ──────────────────────────────────────

  /** Get punch details for an employee within a date range (max 31 days) */
  async getPunchDetails(
    employeeId: string,
    startDate: string,
    endDate: string
  ): Promise<PunchDetail[]> {
    return this.ngFetch<PunchDetail[]>(
      `/apiHub/time/v2/companies/${this.config.companyId}/employees/${employeeId}/punchDetails`,
      { relativeStart: startDate, relativeEnd: endDate }
    );
  }

  // ─── NextGen: Shifts/Schedules ───────────────────────────────────

  /** Get shifts for an employee */
  async getEmployeeShifts(
    employeeId: string,
    opts?: { limit?: number; offset?: number; include?: string }
  ): Promise<EmployeeShift[]> {
    const params: Record<string, string> = {
      limit: String(opts?.limit ?? 25),
      offset: String(opts?.offset ?? 0),
    };
    if (opts?.include) params.include = opts.include;
    return this.ngFetch<EmployeeShift[]>(
      `/apiHub/scheduling/v1/companies/${this.config.companyId}/employees/${employeeId}/shifts`,
      params
    );
  }

  // ─── NextGen: Job Codes ──────────────────────────────────────────

  /** Get all job codes */
  async getJobCodes(): Promise<JobCode[]> {
    const all: JobCode[] = [];
    let offset = 0;
    const limit = 100;

    while (true) {
      const batch = await this.ngFetch<JobCode[]>(
        `/apiHub/payroll/v1/companies/${this.config.companyId}/jobs`,
        { limit: String(limit), offset: String(offset), includeTotalCount: "true" }
      );
      all.push(...batch);
      if (batch.length < limit) break;
      offset += limit;
    }

    return all;
  }

  // ─── NextGen: Cost Centers ───────────────────────────────────────

  /** Get all cost center levels and their codes */
  async getCostCenters(): Promise<CostCenterLevel[]> {
    return this.ngFetch<CostCenterLevel[]>(
      `/apiHub/corehr/v1/companies/${this.config.companyId}/costCentersAndLevels`
    );
  }

  // ─── WebLink: Pay Statements ─────────────────────────────────────

  /**
   * Get pay statement summaries for an employee for a given year.
   * Paginates automatically.
   */
  async getPayStatementSummary(
    employeeId: string,
    year: number,
    opts?: { checkDate?: string }
  ): Promise<PayStatementSummary[]> {
    const all: PayStatementSummary[] = [];
    let page = 0;
    const pageSize = 100;

    const basePath = opts?.checkDate
      ? `/companies/${this.config.companyId}/employees/${employeeId}/paystatement/summary/${year}/${opts.checkDate}`
      : `/companies/${this.config.companyId}/employees/${employeeId}/paystatement/summary/${year}`;

    while (true) {
      const batch = await this.wlFetch<PayStatementSummary[]>(basePath, {
        pagesize: String(pageSize),
        pagenumber: String(page),
        includetotalcount: "true",
      }, { emptyOn404: true });

      all.push(...batch);
      if (batch.length < pageSize) break;
      page++;
    }

    return all;
  }

  /**
   * Get pay statement line-item details for an employee for a given year.
   * Paginates automatically.
   */
  async getPayStatementDetails(
    employeeId: string,
    year: number,
    opts?: { checkDate?: string }
  ): Promise<PayStatementDetail[]> {
    const all: PayStatementDetail[] = [];
    let page = 0;
    const pageSize = 100;

    const basePath = opts?.checkDate
      ? `/companies/${this.config.companyId}/employees/${employeeId}/paystatement/details/${year}/${opts.checkDate}`
      : `/companies/${this.config.companyId}/employees/${employeeId}/paystatement/details/${year}`;

    while (true) {
      const batch = await this.wlFetch<PayStatementDetail[]>(basePath, {
        pagesize: String(pageSize),
        pagenumber: String(page),
        includetotalcount: "true",
      }, { emptyOn404: true });

      all.push(...batch);
      if (batch.length < pageSize) break;
      page++;
    }

    return all;
  }

  // ─── WebLink: Local Taxes ────────────────────────────────────────

  /** Get all local taxes for an employee */
  async getLocalTaxes(employeeId: string): Promise<LocalTax[]> {
    return this.wlFetch<LocalTax[]>(
      `/companies/${this.config.companyId}/employees/${employeeId}/localTaxes`
    );
  }

  /** Get a specific local tax by code */
  async getLocalTax(employeeId: string, taxCode: string): Promise<LocalTax> {
    return this.wlFetch<LocalTax>(
      `/companies/${this.config.companyId}/employees/${employeeId}/localTaxes/${taxCode}`
    );
  }
}
