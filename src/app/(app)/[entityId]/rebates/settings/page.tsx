"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Plus, Trash2, Loader2, Save } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";

interface ExcludedICode {
  id?: string;
  i_code: string;
  description: string | null;
}

export default function RebateSettingsPage() {
  const params = useParams();
  const entityId = params.entityId as string;

  const [globalICodes, setGlobalICodes] = useState<ExcludedICode[]>([]);
  const [excludedAmounts, setExcludedAmounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);

  // Input for adding new I-code
  const [newICode, setNewICode] = useState("");

  const loadData = useCallback(async () => {
    try {
      const res = await fetch("/api/rebates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get_config", entityId }),
      });
      const data = await res.json();
      setGlobalICodes(data.globalExcludedICodes || []);
      setExcludedAmounts(data.excludedAmountsByICode || {});
    } finally {
      setLoading(false);
    }
  }, [entityId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const addICode = async () => {
    const code = newICode.trim();
    if (!code) return;
    if (globalICodes.some((ic) => ic.i_code === code)) {
      toast.error("I-Code already in list");
      return;
    }

    setAdding(true);
    try {
      // Look up description from synced invoice items
      const res = await fetch("/api/rebates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "lookup_icode", entityId, iCode: code }),
      });
      const data = await res.json();
      const description = data.description || null;

      setGlobalICodes((prev) => [...prev, { i_code: code, description }]);
      setNewICode("");
      if (description) {
        toast.success(`Found: ${description}`);
      } else {
        toast.info("I-Code added (no description found in synced data)");
      }
    } catch {
      // Still add it even if lookup fails
      setGlobalICodes((prev) => [...prev, { i_code: code, description: null }]);
      setNewICode("");
    } finally {
      setAdding(false);
    }
  };

  const removeICode = (iCode: string) => {
    setGlobalICodes((prev) => prev.filter((ic) => ic.i_code !== iCode));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Auto-add any I-code typed in the input field before saving
      let icodesToSave = [...globalICodes];
      const pendingCode = newICode.trim();
      if (pendingCode && !icodesToSave.some((ic) => ic.i_code === pendingCode)) {
        // Quick lookup for the pending code too
        try {
          const lookupRes = await fetch("/api/rebates", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "lookup_icode", entityId, iCode: pendingCode }),
          });
          const lookupData = await lookupRes.json();
          const newEntry = { i_code: pendingCode, description: lookupData.description || null };
          icodesToSave = [...icodesToSave, newEntry];
          setGlobalICodes(icodesToSave);
        } catch {
          icodesToSave = [...icodesToSave, { i_code: pendingCode, description: null }];
          setGlobalICodes(icodesToSave);
        }
        setNewICode("");
      }

      const res = await fetch("/api/rebates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "upsert_excluded_icodes",
          entityId,
          icodes: icodesToSave.map((ic) => ({
            i_code: ic.i_code,
            description: ic.description,
          })),
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`Saved ${data.savedCount || 0} excluded I-Code(s)`);
        // Reload to get fresh data including any auto-resolved descriptions
        await loadData();
      } else {
        toast.error(data.error || "Save failed");
      }
    } catch {
      toast.error("Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const totalExcluded = globalICodes.reduce(
    (sum, ic) => sum + (excludedAmounts[ic.i_code] || 0),
    0
  );

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href={`/${entityId}/rebates`}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-semibold">Rebate Settings</h1>
          <p className="text-muted-foreground">
            Configure global settings for rebate calculations
          </p>
        </div>
      </div>

      {/* Global Excluded I-Codes */}
      <Card>
        <CardHeader>
          <CardTitle>Global Excluded I-Codes</CardTitle>
          <CardDescription>
            These I-Codes will be excluded from rebate calculations for all
            customers that have &quot;Use global exclusions&quot; enabled.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Add new I-code */}
          <div className="flex gap-2 items-end">
            <div className="space-y-1 flex-1">
              <Input
                value={newICode}
                onChange={(e) => setNewICode(e.target.value)}
                placeholder="Enter I-Code (e.g., 100305)"
                className="font-mono"
                onKeyDown={(e) => e.key === "Enter" && addICode()}
                disabled={adding}
              />
            </div>
            <Button variant="outline" onClick={addICode} disabled={adding || !newICode.trim()}>
              {adding ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-1 h-4 w-4" />
              )}
              Add
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save
            </Button>
          </div>

          {/* I-Codes table */}
          {globalICodes.length === 0 ? (
            <p className="text-sm text-muted-foreground pt-2">
              No excluded I-Codes configured. Add one above to get started.
            </p>
          ) : (
            <div className="border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[120px]">I-Code</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="w-[150px] text-right">Excluded Amount</TableHead>
                    <TableHead className="w-[60px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {globalICodes.map((ic) => {
                    const amt = excludedAmounts[ic.i_code] || 0;
                    return (
                      <TableRow key={ic.i_code}>
                        <TableCell className="font-mono font-medium">
                          {ic.i_code}
                        </TableCell>
                        <TableCell>
                          {ic.description || (
                            <span className="text-muted-foreground italic">No description</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {amt > 0 ? (
                            <span className="text-red-600 font-medium">
                              ${amt.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">$0.00</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => removeICode(ic.i_code)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {/* Totals row */}
                  {globalICodes.length > 1 && (
                    <TableRow className="bg-muted/50 font-medium">
                      <TableCell />
                      <TableCell className="text-right text-sm text-muted-foreground">
                        Total Excluded
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {totalExcluded > 0 ? (
                          <span className="text-red-600 font-medium">
                            ${totalExcluded.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">$0.00</span>
                        )}
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
