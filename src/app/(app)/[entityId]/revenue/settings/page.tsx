"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";

interface Account {
  id: string;
  name: string;
  account_number: string | null;
}

interface RevenueSettings {
  accrued_account_id: string | null;
  deferred_account_id: string | null;
  revenue_account_id: string | null;
}

export default function RevenueSettingsPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const router = useRouter();
  const supabase = createClient();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [settings, setSettings] = useState<RevenueSettings>({
    accrued_account_id: null,
    deferred_account_id: null,
    revenue_account_id: null,
  });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    // Load GL accounts
    const { data: accts } = await supabase
      .from("accounts")
      .select("id, name, account_number")
      .eq("entity_id", entityId)
      .eq("is_active", true)
      .order("account_number")
      .order("name");

    setAccounts((accts as Account[]) ?? []);

    // Load most recent schedule to get saved GL mappings
    const { data: sched } = await supabase
      .from("revenue_schedules")
      .select("accrued_account_id, deferred_account_id, revenue_account_id")
      .eq("entity_id", entityId)
      .order("period_year", { ascending: false })
      .order("period_month", { ascending: false })
      .limit(1)
      .single();

    if (sched) {
      setSettings({
        accrued_account_id: (sched as unknown as RevenueSettings).accrued_account_id,
        deferred_account_id: (sched as unknown as RevenueSettings).deferred_account_id,
        revenue_account_id: (sched as unknown as RevenueSettings).revenue_account_id,
      });
    }

    setLoading(false);
  }, [supabase, entityId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleSave() {
    setSaving(true);

    // Update all existing schedules for this entity with the new GL mappings
    const { error } = await supabase
      .from("revenue_schedules")
      .update({
        accrued_account_id: settings.accrued_account_id,
        deferred_account_id: settings.deferred_account_id,
        revenue_account_id: settings.revenue_account_id,
      })
      .eq("entity_id", entityId);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Revenue GL account mappings saved");
    }

    setSaving(false);
  }

  const accountLabel = (id: string) => {
    const a = accounts.find((a) => a.id === id);
    if (!a) return "";
    return a.account_number ? `${a.account_number} - ${a.name}` : a.name;
  };

  if (loading) {
    return <p className="text-muted-foreground p-6">Loading settings...</p>;
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push(`/${entityId}/revenue`)}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Revenue Settings
          </h1>
          <p className="text-muted-foreground">
            Configure GL account mappings for revenue accruals and deferrals
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>GL Account Mappings</CardTitle>
          <CardDescription>
            These accounts will be used when posting revenue accrual and deferral
            journal entries.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Accrued Revenue Account</Label>
            <p className="text-xs text-muted-foreground">
              Balance sheet account for revenue earned but not yet billed
            </p>
            <Select
              value={settings.accrued_account_id ?? "none"}
              onValueChange={(v) =>
                setSettings((s) => ({
                  ...s,
                  accrued_account_id: v === "none" ? null : v,
                }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select account..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">-- None --</SelectItem>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.account_number
                      ? `${a.account_number} - ${a.name}`
                      : a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Deferred Revenue Account</Label>
            <p className="text-xs text-muted-foreground">
              Balance sheet account for revenue billed but not yet earned
            </p>
            <Select
              value={settings.deferred_account_id ?? "none"}
              onValueChange={(v) =>
                setSettings((s) => ({
                  ...s,
                  deferred_account_id: v === "none" ? null : v,
                }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select account..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">-- None --</SelectItem>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.account_number
                      ? `${a.account_number} - ${a.name}`
                      : a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Revenue Account</Label>
            <p className="text-xs text-muted-foreground">
              Income statement account for rental revenue
            </p>
            <Select
              value={settings.revenue_account_id ?? "none"}
              onValueChange={(v) =>
                setSettings((s) => ({
                  ...s,
                  revenue_account_id: v === "none" ? null : v,
                }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select account..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">-- None --</SelectItem>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.account_number
                      ? `${a.account_number} - ${a.name}`
                      : a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button onClick={handleSave} disabled={saving} className="mt-4">
            {saving ? "Saving..." : "Save Settings"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Spreadsheet Format</CardTitle>
          <CardDescription>
            Expected column headers in your upload spreadsheet
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-sm space-y-2">
            <p>
              The upload parser automatically detects column headers. Your
              spreadsheet should include columns for:
            </p>
            <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
              <li>
                <strong>Contract #</strong> — rental contract identifier
              </li>
              <li>
                <strong>Customer</strong> — customer or renter name
              </li>
              <li>
                <strong>Description</strong> — vehicle or unit description
              </li>
              <li>
                <strong>Rental Start</strong> — start date of the rental
              </li>
              <li>
                <strong>Rental End</strong> — end date of the rental
              </li>
              <li>
                <strong>Total Value</strong> — total contract value in dollars
              </li>
              <li>
                <strong>Billed Amount</strong> — amount invoiced for this period
              </li>
            </ul>
            <p className="text-muted-foreground mt-4">
              The system calculates a daily rate from the total value and rental
              period, then determines how many days fall within the selected
              accounting period to compute earned revenue. The difference between
              earned and billed determines the accrual or deferral.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
