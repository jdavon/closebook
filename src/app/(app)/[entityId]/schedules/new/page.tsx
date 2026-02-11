"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import type { ScheduleType } from "@/lib/types/database";

const DEFAULT_COLUMNS: Record<ScheduleType, Array<{ key: string; name: string; type: string; width: number }>> = {
  prepaid: [
    { key: "description", name: "Description", type: "text", width: 200 },
    { key: "vendor", name: "Vendor", type: "text", width: 150 },
    { key: "total", name: "Total Amount", type: "currency", width: 120 },
    { key: "monthly", name: "Monthly Amort.", type: "currency", width: 120 },
    { key: "remaining", name: "Remaining", type: "currency", width: 120 },
  ],
  fixed_asset: [
    { key: "description", name: "Description", type: "text", width: 200 },
    { key: "beginning", name: "Beg. Balance", type: "currency", width: 120 },
    { key: "additions", name: "Additions", type: "currency", width: 120 },
    { key: "disposals", name: "Disposals", type: "currency", width: 120 },
    { key: "depreciation", name: "Depreciation", type: "currency", width: 120 },
    { key: "ending", name: "End. Balance", type: "currency", width: 120 },
  ],
  debt: [
    { key: "lender", name: "Lender", type: "text", width: 150 },
    { key: "principal", name: "Principal", type: "currency", width: 120 },
    { key: "rate", name: "Rate", type: "percentage", width: 80 },
    { key: "payment", name: "Monthly Pmt", type: "currency", width: 120 },
    { key: "balance", name: "Balance", type: "currency", width: 120 },
  ],
  accrual: [
    { key: "description", name: "Description", type: "text", width: 200 },
    { key: "amount", name: "Amount", type: "currency", width: 120 },
    { key: "reversal_date", name: "Reversal Date", type: "date", width: 120 },
    { key: "status", name: "Status", type: "text", width: 100 },
  ],
  custom: [
    { key: "description", name: "Description", type: "text", width: 250 },
    { key: "amount", name: "Amount", type: "currency", width: 150 },
  ],
};

interface Account {
  id: string;
  name: string;
  account_number: string | null;
}

export default function NewSchedulePage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const router = useRouter();
  const supabase = createClient();

  const [name, setName] = useState("");
  const [scheduleType, setScheduleType] = useState<ScheduleType>("prepaid");
  const [accountId, setAccountId] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [creating, setCreating] = useState(false);

  const loadAccounts = useCallback(async () => {
    const { data } = await supabase
      .from("accounts")
      .select("id, name, account_number")
      .eq("entity_id", entityId)
      .eq("is_active", true)
      .order("account_number")
      .order("name");

    setAccounts((data as Account[]) ?? []);
  }, [supabase, entityId]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);

    const columns = DEFAULT_COLUMNS[scheduleType];

    const { data, error } = await supabase
      .from("schedules")
      .insert({
        entity_id: entityId,
        name,
        schedule_type: scheduleType,
        column_definitions: columns,
        account_id: accountId || null,
      })
      .select()
      .single();

    if (error) {
      toast.error(error.message);
      setCreating(false);
      return;
    }

    toast.success("Schedule created");
    router.push(`/${entityId}/schedules/${data.id}`);
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push(`/${entityId}/schedules`)}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New Schedule</CardTitle>
          <CardDescription>
            Create a supporting schedule tied to a GL account
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleCreate}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Schedule Name</Label>
              <Input
                id="name"
                placeholder="e.g., Prepaid Expenses - January 2026"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="type">Schedule Type</Label>
              <Select
                value={scheduleType}
                onValueChange={(v) => setScheduleType(v as ScheduleType)}
              >
                <SelectTrigger id="type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="prepaid">Prepaid Expense</SelectItem>
                  <SelectItem value="fixed_asset">
                    Fixed Asset Roll-Forward
                  </SelectItem>
                  <SelectItem value="debt">Debt Schedule</SelectItem>
                  <SelectItem value="accrual">Accrual Schedule</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="account">Linked GL Account (optional)</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger id="account">
                  <SelectValue placeholder="Select an account..." />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.account_number
                        ? `${account.account_number} - ${account.name}`
                        : account.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" disabled={creating}>
              {creating ? "Creating..." : "Create Schedule"}
            </Button>
          </CardContent>
        </form>
      </Card>
    </div>
  );
}
