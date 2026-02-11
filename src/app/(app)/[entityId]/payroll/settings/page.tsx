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
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle, XCircle, AlertCircle } from "lucide-react";

interface PaylocityConnection {
  id: string;
  client_id: string;
  company_id: string;
  environment: string;
  sync_status: string;
  last_sync_at: string | null;
  sync_error: string | null;
  connected_by: string | null;
  created_at: string;
}

interface Account {
  id: string;
  name: string;
  account_number: string | null;
}

interface PayrollAccrualGLMapping {
  wages_account_id: string | null;
  wages_offset_account_id: string | null;
  tax_account_id: string | null;
  tax_offset_account_id: string | null;
  pto_account_id: string | null;
  pto_offset_account_id: string | null;
}

export default function PayrollSettingsPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const router = useRouter();
  const supabase = createClient();

  const [connection, setConnection] = useState<PaylocityConnection | null>(
    null
  );
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);

  // Connect form
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [environment, setEnvironment] = useState("production");
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  // GL mappings
  const [glMapping, setGlMapping] = useState<PayrollAccrualGLMapping>({
    wages_account_id: null,
    wages_offset_account_id: null,
    tax_account_id: null,
    tax_offset_account_id: null,
    pto_account_id: null,
    pto_offset_account_id: null,
  });
  const [savingGL, setSavingGL] = useState(false);

  const loadData = useCallback(async () => {
    // Load connection
    const { data: conn } = await supabase
      .from("paylocity_connections")
      .select("*")
      .eq("entity_id", entityId)
      .single();

    setConnection((conn as unknown as PaylocityConnection) ?? null);

    // Load accounts
    const { data: accts } = await supabase
      .from("accounts")
      .select("id, name, account_number")
      .eq("entity_id", entityId)
      .eq("is_active", true)
      .order("account_number")
      .order("name");

    setAccounts((accts as Account[]) ?? []);

    // Load GL mappings from most recent accruals
    const { data: recentAccruals } = await supabase
      .from("payroll_accruals")
      .select("accrual_type, account_id, offset_account_id")
      .eq("entity_id", entityId)
      .order("created_at", { ascending: false })
      .limit(10);

    if (recentAccruals && recentAccruals.length > 0) {
      const mapping: PayrollAccrualGLMapping = { ...glMapping };
      for (const a of recentAccruals as Array<{
        accrual_type: string;
        account_id: string | null;
        offset_account_id: string | null;
      }>) {
        if (a.accrual_type === "wages") {
          mapping.wages_account_id = mapping.wages_account_id ?? a.account_id;
          mapping.wages_offset_account_id =
            mapping.wages_offset_account_id ?? a.offset_account_id;
        } else if (a.accrual_type === "payroll_tax") {
          mapping.tax_account_id = mapping.tax_account_id ?? a.account_id;
          mapping.tax_offset_account_id =
            mapping.tax_offset_account_id ?? a.offset_account_id;
        } else if (a.accrual_type === "pto") {
          mapping.pto_account_id = mapping.pto_account_id ?? a.account_id;
          mapping.pto_offset_account_id =
            mapping.pto_offset_account_id ?? a.offset_account_id;
        }
      }
      setGlMapping(mapping);
    }

    setLoading(false);
  }, [supabase, entityId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    setConnecting(true);

    try {
      const res = await fetch("/api/paylocity/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityId,
          clientId,
          clientSecret,
          companyId,
          environment,
        }),
      });

      const json = await res.json();

      if (!res.ok) {
        toast.error(json.error || "Connection failed");
      } else {
        toast.success("Connected to Paylocity");
        setClientId("");
        setClientSecret("");
        setCompanyId("");
        loadData();
      }
    } catch {
      toast.error("Connection failed — network error");
    }

    setConnecting(false);
  }

  async function handleDisconnect() {
    setDisconnecting(true);

    try {
      const res = await fetch("/api/paylocity/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityId }),
      });

      if (!res.ok) {
        const json = await res.json();
        toast.error(json.error || "Disconnect failed");
      } else {
        toast.success("Disconnected from Paylocity");
        setConnection(null);
      }
    } catch {
      toast.error("Disconnect failed");
    }

    setDisconnecting(false);
  }

  async function handleSaveGL() {
    setSavingGL(true);

    // Update all existing accruals with the GL mappings by type
    const updates = [
      {
        type: "wages",
        account_id: glMapping.wages_account_id,
        offset_account_id: glMapping.wages_offset_account_id,
      },
      {
        type: "payroll_tax",
        account_id: glMapping.tax_account_id,
        offset_account_id: glMapping.tax_offset_account_id,
      },
      {
        type: "pto",
        account_id: glMapping.pto_account_id,
        offset_account_id: glMapping.pto_offset_account_id,
      },
    ];

    for (const u of updates) {
      await supabase
        .from("payroll_accruals")
        .update({
          account_id: u.account_id,
          offset_account_id: u.offset_account_id,
        })
        .eq("entity_id", entityId)
        .eq("accrual_type", u.type);
    }

    toast.success("GL account mappings saved");
    setSavingGL(false);
  }

  if (loading) {
    return <p className="text-muted-foreground p-6">Loading settings...</p>;
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push(`/${entityId}/payroll`)}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Payroll Settings
          </h1>
          <p className="text-muted-foreground">
            Manage Paylocity connection and GL account mappings
          </p>
        </div>
      </div>

      {/* Connection Card */}
      <Card>
        <CardHeader>
          <CardTitle>Paylocity Connection</CardTitle>
          <CardDescription>
            Connect your Paylocity account to automatically sync payroll data
          </CardDescription>
        </CardHeader>
        <CardContent>
          {connection ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                {connection.sync_status === "error" ? (
                  <AlertCircle className="h-5 w-5 text-destructive" />
                ) : (
                  <CheckCircle className="h-5 w-5 text-green-600" />
                )}
                <div>
                  <p className="font-medium">Connected</p>
                  <p className="text-sm text-muted-foreground">
                    Company ID: {connection.company_id} &middot;{" "}
                    <Badge variant="outline">{connection.environment}</Badge>
                  </p>
                </div>
              </div>
              {connection.last_sync_at && (
                <p className="text-sm text-muted-foreground">
                  Last synced:{" "}
                  {new Date(connection.last_sync_at).toLocaleString()}
                </p>
              )}
              {connection.sync_error && (
                <p className="text-sm text-destructive">
                  Error: {connection.sync_error}
                </p>
              )}
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDisconnect}
                disabled={disconnecting}
              >
                <XCircle className="mr-2 h-4 w-4" />
                {disconnecting ? "Disconnecting..." : "Disconnect"}
              </Button>
            </div>
          ) : (
            <form onSubmit={handleConnect} className="space-y-4">
              <div className="space-y-2">
                <Label>Environment</Label>
                <Select value={environment} onValueChange={setEnvironment}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="production">Production</SelectItem>
                    <SelectItem value="testing">
                      Sandbox / Testing
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Client ID</Label>
                <Input
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="Your Paylocity API Client ID"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Client Secret</Label>
                <Input
                  type="password"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  placeholder="Your Paylocity API Client Secret"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Company ID</Label>
                <Input
                  value={companyId}
                  onChange={(e) => setCompanyId(e.target.value)}
                  placeholder="Your Paylocity Company ID"
                  required
                />
              </div>
              <Button type="submit" disabled={connecting}>
                {connecting ? "Connecting..." : "Connect to Paylocity"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      {/* GL Account Mappings */}
      <Card>
        <CardHeader>
          <CardTitle>GL Account Mappings</CardTitle>
          <CardDescription>
            Map each accrual type to the appropriate GL accounts for journal
            entry posting
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Wages */}
          <div className="space-y-3">
            <h4 className="font-medium">Accrued Wages</h4>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">
                  Credit: Wages Payable (Liability)
                </Label>
                <Select
                  value={glMapping.wages_account_id ?? "none"}
                  onValueChange={(v) =>
                    setGlMapping((m) => ({
                      ...m,
                      wages_account_id: v === "none" ? null : v,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select..." />
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
                <Label className="text-xs text-muted-foreground">
                  Debit: Wage Expense
                </Label>
                <Select
                  value={glMapping.wages_offset_account_id ?? "none"}
                  onValueChange={(v) =>
                    setGlMapping((m) => ({
                      ...m,
                      wages_offset_account_id: v === "none" ? null : v,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select..." />
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
            </div>
          </div>

          {/* Payroll Tax */}
          <div className="space-y-3">
            <h4 className="font-medium">Payroll Tax</h4>
            <p className="text-xs text-muted-foreground">
              Default rate: 12.85% (FICA 7.65% + FUTA 0.6% + CA SUI 3.4% + CA
              ETT 0.1% + CA SDI 1.1%)
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">
                  Credit: Payroll Tax Payable (Liability)
                </Label>
                <Select
                  value={glMapping.tax_account_id ?? "none"}
                  onValueChange={(v) =>
                    setGlMapping((m) => ({
                      ...m,
                      tax_account_id: v === "none" ? null : v,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select..." />
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
                <Label className="text-xs text-muted-foreground">
                  Debit: Payroll Tax Expense
                </Label>
                <Select
                  value={glMapping.tax_offset_account_id ?? "none"}
                  onValueChange={(v) =>
                    setGlMapping((m) => ({
                      ...m,
                      tax_offset_account_id: v === "none" ? null : v,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select..." />
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
            </div>
          </div>

          {/* PTO */}
          <div className="space-y-3">
            <h4 className="font-medium">PTO Liability</h4>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">
                  Credit: PTO Payable (Liability)
                </Label>
                <Select
                  value={glMapping.pto_account_id ?? "none"}
                  onValueChange={(v) =>
                    setGlMapping((m) => ({
                      ...m,
                      pto_account_id: v === "none" ? null : v,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select..." />
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
                <Label className="text-xs text-muted-foreground">
                  Debit: PTO Expense
                </Label>
                <Select
                  value={glMapping.pto_offset_account_id ?? "none"}
                  onValueChange={(v) =>
                    setGlMapping((m) => ({
                      ...m,
                      pto_offset_account_id: v === "none" ? null : v,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select..." />
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
            </div>
          </div>

          <Button onClick={handleSaveGL} disabled={savingGL}>
            {savingGL ? "Saving..." : "Save GL Mappings"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
