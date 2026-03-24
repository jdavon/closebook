"use client";

import { useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Loader2, AlertCircle } from "lucide-react";

// --- Types ---

interface DetailTarget {
  employeeId: string;
  companyId: string;
  year: number;
  month: number;
  name: string;
}

interface AllocatedAmounts {
  grossPay: number;
  hours?: number;
  regularHours: number;
  regularDollars: number;
  overtimeHours: number;
  overtimeDollars: number;
  doubletimeHours: number;
  doubletimeDollars: number;
  mealDollars: number;
  otherEarningsDollars: number;
  erTaxes: number;
  erBenefits: number;
  erBenefitDetail?: Record<string, number>;
}

interface PaycheckEntry {
  checkDate: string;
  beginDate: string;
  endDate: string;
  payPeriodDays: number;
  daysInMonth: number;
  proRataFraction: number;
  full: AllocatedAmounts;
  allocated: AllocatedAmounts;
}

interface AccrualInfo {
  daysUncovered: number;
  daysInMonth: number;
  dailyRate: number;
  estimatedGross: number;
  estimatedErTaxes: number;
  estimatedErBenefits: number;
}

interface DetailResponse {
  employeeName: string;
  payType: string;
  annualComp: number;
  year: number;
  month: number;
  daysInMonth: number;
  paychecks: PaycheckEntry[];
  accrual: AccrualInfo | null;
  totalAllocated: AllocatedAmounts;
}

const MONTH_LABELS = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const BENEFIT_LABELS: Record<string, string> = {
  ERMED: "Medical/Dental/Vision",
  "401ER": "401(k) Match",
};

// --- Helpers ---

function fmt(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(n);
}

function fmtHrs(n: number): string {
  return n > 0 ? n.toFixed(1) : "---";
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function fmtDate(d: string): string {
  const [y, m, day] = d.split("-");
  return `${m}/${day}/${y}`;
}

// --- Component ---

export function PaycheckDetailSheet({
  target,
  onClose,
}: {
  target: DetailTarget | null;
  onClose: () => void;
}) {
  const [data, setData] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) {
      setData(null);
      return;
    }

    setLoading(true);
    setError(null);

    fetch(
      `/api/paylocity/monthly-costs/detail?employeeId=${target.employeeId}&companyId=${target.companyId}&year=${target.year}&month=${target.month}`
    )
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json();
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        return res.json();
      })
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [target]);

  return (
    <Sheet open={!!target} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="sm:max-w-[640px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            {target?.name ?? "Employee"} &mdash; {MONTH_LABELS[target?.month ?? 0]} {target?.year}
          </SheetTitle>
          <SheetDescription>
            Monthly cost breakdown with per-paycheck detail
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-6">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 text-destructive text-sm">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}

          {data && !loading && (
            <>
              {/* Summary */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground">Pay Type</span>
                  <p className="font-medium">{data.payType}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Annual Comp</span>
                  <p className="font-medium">{fmt(data.annualComp ?? 0)}</p>
                </div>
              </div>

              {/* Totals bar */}
              <div className="rounded-lg border p-4">
                <h3 className="text-sm font-semibold mb-3">Month Total (Allocated)</h3>
                <div className="grid grid-cols-2 gap-y-2 gap-x-6 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Regular Time</span>
                    <span className="font-mono">{fmt(data.totalAllocated.regularDollars)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Overtime</span>
                    <span className="font-mono">{fmt(data.totalAllocated.overtimeDollars)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Double Time</span>
                    <span className="font-mono">{fmt(data.totalAllocated.doubletimeDollars)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Meal Premiums</span>
                    <span className="font-mono">{fmt(data.totalAllocated.mealDollars)}</span>
                  </div>
                  {data.totalAllocated.otherEarningsDollars > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Other Earnings</span>
                      <span className="font-mono">{fmt(data.totalAllocated.otherEarningsDollars)}</span>
                    </div>
                  )}
                  <div className="flex justify-between col-span-2 pt-1 border-t">
                    <span className="font-medium">Gross Pay</span>
                    <span className="font-mono font-medium">{fmt(data.totalAllocated.grossPay)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">ER Taxes (est.)</span>
                    <span className="font-mono">{fmt(data.totalAllocated.erTaxes)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">ER Benefits</span>
                    <span className="font-mono">{fmt(data.totalAllocated.erBenefits)}</span>
                  </div>
                  <div className="flex justify-between col-span-2 pt-1 border-t">
                    <span className="font-semibold">Total Employer Cost</span>
                    <span className="font-mono font-bold">
                      {fmt(
                        data.totalAllocated.grossPay +
                        data.totalAllocated.erTaxes +
                        data.totalAllocated.erBenefits
                      )}
                    </span>
                  </div>
                </div>
              </div>

              {/* Per-paycheck breakdown */}
              <div>
                <h3 className="text-sm font-semibold mb-3">
                  Paychecks ({data.paychecks.length})
                </h3>

                {data.paychecks.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No paychecks with pay periods overlapping this month.
                  </p>
                )}

                <div className="space-y-4">
                  {data.paychecks.map((pc, idx) => (
                    <div key={idx} className="rounded-lg border">
                      {/* Paycheck header */}
                      <div className="flex items-center justify-between px-4 py-2 bg-muted/50 rounded-t-lg">
                        <div className="text-sm">
                          <span className="font-medium">Check: {fmtDate(pc.checkDate)}</span>
                          <span className="text-muted-foreground ml-2">
                            Period: {fmtDate(pc.beginDate)} &ndash; {fmtDate(pc.endDate)}
                          </span>
                        </div>
                        <Badge variant="outline" className="text-xs">
                          {pc.daysInMonth}/{pc.payPeriodDays} days = {fmtPct(pc.proRataFraction)}
                        </Badge>
                      </div>

                      {/* Paycheck detail table */}
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">Category</TableHead>
                            <TableHead className="text-xs text-right">Hours</TableHead>
                            <TableHead className="text-xs text-right">Full Amount</TableHead>
                            <TableHead className="text-xs text-right">Allocated</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          <TableRow>
                            <TableCell className="text-sm">Regular Time</TableCell>
                            <TableCell className="text-right font-mono text-sm">{fmtHrs(pc.full.regularHours)}</TableCell>
                            <TableCell className="text-right font-mono text-sm">{fmt(pc.full.regularDollars)}</TableCell>
                            <TableCell className="text-right font-mono text-sm font-medium">{fmt(pc.allocated.regularDollars)}</TableCell>
                          </TableRow>
                          {(pc.full.overtimeHours > 0 || pc.full.overtimeDollars > 0) && (
                            <TableRow>
                              <TableCell className="text-sm">Overtime (1.5x)</TableCell>
                              <TableCell className="text-right font-mono text-sm">{fmtHrs(pc.full.overtimeHours)}</TableCell>
                              <TableCell className="text-right font-mono text-sm">{fmt(pc.full.overtimeDollars)}</TableCell>
                              <TableCell className="text-right font-mono text-sm font-medium">{fmt(pc.allocated.overtimeDollars)}</TableCell>
                            </TableRow>
                          )}
                          {(pc.full.doubletimeHours > 0 || pc.full.doubletimeDollars > 0) && (
                            <TableRow>
                              <TableCell className="text-sm">Double Time (2x)</TableCell>
                              <TableCell className="text-right font-mono text-sm">{fmtHrs(pc.full.doubletimeHours)}</TableCell>
                              <TableCell className="text-right font-mono text-sm">{fmt(pc.full.doubletimeDollars)}</TableCell>
                              <TableCell className="text-right font-mono text-sm font-medium">{fmt(pc.allocated.doubletimeDollars)}</TableCell>
                            </TableRow>
                          )}
                          {pc.full.mealDollars > 0 && (
                            <TableRow>
                              <TableCell className="text-sm">Meal Premiums</TableCell>
                              <TableCell className="text-right font-mono text-sm">---</TableCell>
                              <TableCell className="text-right font-mono text-sm">{fmt(pc.full.mealDollars)}</TableCell>
                              <TableCell className="text-right font-mono text-sm font-medium">{fmt(pc.allocated.mealDollars)}</TableCell>
                            </TableRow>
                          )}
                          {pc.full.otherEarningsDollars > 0 && (
                            <TableRow>
                              <TableCell className="text-sm">Other Earnings</TableCell>
                              <TableCell className="text-right font-mono text-sm">---</TableCell>
                              <TableCell className="text-right font-mono text-sm">{fmt(pc.full.otherEarningsDollars)}</TableCell>
                              <TableCell className="text-right font-mono text-sm font-medium">{fmt(pc.allocated.otherEarningsDollars)}</TableCell>
                            </TableRow>
                          )}
                          {/* Gross subtotal */}
                          <TableRow className="border-t">
                            <TableCell className="text-sm font-medium">Gross Pay</TableCell>
                            <TableCell className="text-right font-mono text-sm">{fmtHrs(pc.full.hours ?? 0)}</TableCell>
                            <TableCell className="text-right font-mono text-sm">{fmt(pc.full.grossPay)}</TableCell>
                            <TableCell className="text-right font-mono text-sm font-semibold">{fmt(pc.allocated.grossPay)}</TableCell>
                          </TableRow>
                          {/* ER costs */}
                          <TableRow>
                            <TableCell className="text-sm text-muted-foreground">ER Taxes (est.)</TableCell>
                            <TableCell />
                            <TableCell className="text-right font-mono text-sm text-muted-foreground">{fmt(pc.full.erTaxes)}</TableCell>
                            <TableCell className="text-right font-mono text-sm">{fmt(pc.allocated.erTaxes)}</TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell className="text-sm text-muted-foreground">ER Benefits</TableCell>
                            <TableCell />
                            <TableCell className="text-right font-mono text-sm text-muted-foreground">{fmt(pc.full.erBenefits)}</TableCell>
                            <TableCell className="text-right font-mono text-sm">{fmt(pc.allocated.erBenefits)}</TableCell>
                          </TableRow>
                          {/* Benefit breakdown */}
                          {Object.entries(pc.allocated.erBenefitDetail ?? {}).map(([code, amount]) => (
                            <TableRow key={code}>
                              <TableCell className="text-xs text-muted-foreground pl-8">
                                {BENEFIT_LABELS[code] ?? code}
                              </TableCell>
                              <TableCell />
                              <TableCell />
                              <TableCell className="text-right font-mono text-xs text-muted-foreground">
                                {fmt(amount)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ))}
                </div>
              </div>

              {/* Accrual section */}
              {data.accrual && (
                <>
                  <Separator />
                  <div className="rounded-lg border border-dashed p-4">
                    <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                      Accrual Estimate
                      <Badge variant="outline" className="text-xs font-normal">
                        {data.accrual.daysUncovered} days uncovered
                      </Badge>
                    </h3>
                    <p className="text-xs text-muted-foreground mb-3">
                      {data.accrual.daysUncovered} of {data.accrual.daysInMonth} days in the month
                      are not covered by paychecks. Estimated at {fmt(data.accrual.dailyRate)}/day
                      based on annual comp.
                    </p>
                    <div className="grid grid-cols-3 gap-4 text-sm">
                      <div>
                        <span className="text-muted-foreground">Gross</span>
                        <p className="font-mono font-medium">{fmt(data.accrual.estimatedGross)}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">ER Taxes</span>
                        <p className="font-mono font-medium">{fmt(data.accrual.estimatedErTaxes)}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">ER Benefits</span>
                        <p className="font-mono font-medium">{fmt(data.accrual.estimatedErBenefits)}</p>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
