/**
 * Date-aware employee allocation resolver.
 *
 * Resolves which allocation is active for an employee on a given date.
 * An employee can have multiple allocation rows, each with an effective_date.
 * The active allocation for a date is the one with the most recent
 * effective_date <= that date.
 *
 * Pre-sorts allocations per employee at construction time so each
 * date lookup is a single linear scan.
 */

export interface AllocationRow {
  employee_id: string;
  paylocity_company_id: string;
  department: string | null;
  class: string | null;
  allocated_entity_id: string | null;
  allocated_entity_name: string | null;
  effective_date: string; // "YYYY-MM-DD"
}

export class AllocationResolver {
  // Map<"employeeId:companyId", AllocationRow[] sorted by effective_date DESC>
  private byEmployee: Map<string, AllocationRow[]>;

  constructor(rows: AllocationRow[]) {
    this.byEmployee = new Map();
    for (const row of rows) {
      const key = `${row.employee_id}:${row.paylocity_company_id}`;
      if (!this.byEmployee.has(key)) {
        this.byEmployee.set(key, []);
      }
      this.byEmployee.get(key)!.push(row);
    }
    // Sort DESC so the first match in a scan is the most recent
    for (const [, arr] of this.byEmployee) {
      arr.sort((a, b) => b.effective_date.localeCompare(a.effective_date));
    }
  }

  /** Get the allocation active on a specific date. Returns null if none. */
  getForDate(
    employeeId: string,
    companyId: string,
    date: string
  ): AllocationRow | null {
    const arr = this.byEmployee.get(`${employeeId}:${companyId}`);
    if (!arr) return null;
    for (const alloc of arr) {
      if (alloc.effective_date <= date) return alloc;
    }
    return null;
  }

  /** Get all allocation periods for an employee, sorted ASC by effective_date. */
  getAllPeriods(
    employeeId: string,
    companyId: string
  ): AllocationRow[] {
    const arr = this.byEmployee.get(`${employeeId}:${companyId}`);
    if (!arr) return [];
    return [...arr].reverse(); // stored DESC → return ASC
  }

  /** Check if an employee has multiple allocation periods. */
  hasMultiplePeriods(
    employeeId: string,
    companyId: string
  ): boolean {
    return (this.byEmployee.get(`${employeeId}:${companyId}`)?.length ?? 0) > 1;
  }
}
