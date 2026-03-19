"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { RefreshCw, Link2, Unlink, CheckCircle2, AlertCircle, Trash2, Activity, X } from "lucide-react";
import { getCurrentPeriod, getPeriodLabel } from "@/lib/utils/dates";

interface Account {
  id: string;
  name: string;
  account_number: string | null;
  account_type: string;
  classification: string;
}

interface QboConnection {
  id: string;
  company_name: string | null;
  realm_id: string;
  last_sync_at: string | null;
  sync_status: string;
  sync_error: string | null;
}

interface SyncLog {
  id: string;
  sync_type: string;
  status: string;
  records_synced: number;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
}

export default function EntitySettingsPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const entityId = params.entityId as string;
  const supabase = createClient();

  const currentPeriod = getCurrentPeriod();
  const [connection, setConnection] = useState<QboConnection | null>(null);
  const [syncLogs, setSyncLogs] = useState<SyncLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncYear, setSyncYear] = useState(String(currentPeriod.year));
  const [syncMonth, setSyncMonth] = useState(String(currentPeriod.month));
  const [entityName, setEntityName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");

  // Drift monitoring state
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [monitoredAccountIds, setMonitoredAccountIds] = useState<Set<string>>(new Set());
  const [driftSaving, setDriftSaving] = useState(false);
  const [driftFilter, setDriftFilter] = useState("");

  // Show toast based on callback result
  useEffect(() => {
    const connected = searchParams.get("qbo_connected");
    const error = searchParams.get("error");
    if (connected === "true") {
      toast.success("QuickBooks connected successfully!");
    } else if (error) {
      const detail = searchParams.get("detail");
      toast.error(`QBO error: ${error}${detail ? ` — ${detail}` : ""}`);
    }
  }, [searchParams]);

  const loadData = useCallback(async () => {
    // Load entity name
    const { data: entity } = await supabase
      .from("entities")
      .select("name")
      .eq("id", entityId)
      .single();

    if (entity) {
      setEntityName(entity.name);
    }

    const { data: conn } = await supabase
      .from("qbo_connections")
      .select("id, company_name, realm_id, last_sync_at, sync_status, sync_error")
      .eq("entity_id", entityId)
      .single();

    setConnection(conn as QboConnection | null);

    if (conn) {
      const { data: logs } = await supabase
        .from("qbo_sync_logs")
        .select("*")
        .eq("qbo_connection_id", conn.id)
        .order("started_at", { ascending: false })
        .limit(10);

      setSyncLogs((logs as SyncLog[]) ?? []);
    }

    // Load all active accounts for drift monitoring selector
    const { data: accts } = await supabase
      .from("accounts")
      .select("id, name, account_number, account_type, classification")
      .eq("entity_id", entityId)
      .eq("is_active", true)
      .order("classification")
      .order("account_type")
      .order("name");

    if (accts) {
      setAccounts(accts as Account[]);
    }

    // Load currently monitored accounts
    const { data: monitored } = await supabase
      .from("drift_monitored_accounts")
      .select("account_id")
      .eq("entity_id", entityId);

    if (monitored) {
      setMonitoredAccountIds(new Set(monitored.map((m) => m.account_id)));
    }

    setLoading(false);
  }, [supabase, entityId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleConnect() {
    try {
      const response = await fetch("/api/qbo/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityId }),
      });

      const data = await response.json();

      if (data.authUrl) {
        window.location.href = data.authUrl;
      } else {
        toast.error(data.error || "Failed to initiate QBO connection");
      }
    } catch {
      toast.error("Failed to connect to QuickBooks");
    }
  }

  async function handleSync() {
    setSyncing(true);
    const year = parseInt(syncYear);
    const month = parseInt(syncMonth);
    try {
      const response = await fetch("/api/qbo/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityId,
          syncType: "full",
          periodYear: year,
          periodMonth: month,
        }),
      });

      if (!response.ok || !response.body) {
        const errData = await response.json().catch(() => ({}));
        toast.error(errData.error || "Sync failed");
        setSyncing(false);
        return;
      }

      // Read SSE stream until done
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let lastEvent: Record<string, unknown> = {};

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try { lastEvent = JSON.parse(line.slice(6)); } catch { /* skip */ }
          }
        }
      }

      if (lastEvent.error) {
        toast.error(String(lastEvent.error));
      } else {
        toast.success(
          `Sync completed for ${getPeriodLabel(year, month)} — ${lastEvent.recordsSynced ?? 0} records`
        );
        loadData();
      }
    } catch {
      toast.error("Sync failed");
    }
    setSyncing(false);
  }

  async function handleDisconnect() {
    try {
      const response = await fetch("/api/qbo/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityId }),
      });

      if (response.ok) {
        toast.success("QuickBooks disconnected");
        setConnection(null);
        setSyncLogs([]);
      } else {
        const data = await response.json();
        toast.error(data.error || "Failed to disconnect");
      }
    } catch {
      toast.error("Failed to disconnect");
    }
  }

  function toggleMonitoredAccount(accountId: string) {
    setMonitoredAccountIds((prev) => {
      const next = new Set(prev);
      if (next.has(accountId)) {
        next.delete(accountId);
      } else {
        next.add(accountId);
      }
      return next;
    });
  }

  async function handleSaveDriftMonitoring() {
    setDriftSaving(true);
    try {
      const response = await fetch("/api/drift/monitored-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityId,
          accountIds: Array.from(monitoredAccountIds),
        }),
      });

      if (response.ok) {
        toast.success(`Monitoring ${monitoredAccountIds.size} accounts for drift`);
      } else {
        const data = await response.json();
        toast.error(data.error || "Failed to save drift settings");
      }
    } catch {
      toast.error("Failed to save drift settings");
    }
    setDriftSaving(false);
  }

  async function handleDeleteEntity() {
    if (deleteConfirmation !== entityName) return;

    setDeleting(true);
    try {
      const response = await fetch("/api/entities", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityId }),
      });

      const data = await response.json();

      if (!response.ok) {
        toast.error(data.error || "Failed to delete entity");
        setDeleting(false);
        return;
      }

      toast.success("Entity deleted successfully");
      router.push("/settings");
    } catch {
      toast.error("Failed to delete entity");
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Entity Settings
        </h1>
        <p className="text-muted-foreground">
          Manage QuickBooks connection and sync settings
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>QuickBooks Online Connection</CardTitle>
          <CardDescription>
            Connect to QuickBooks Online to sync your chart of accounts and
            balances
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : connection ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 rounded-lg border bg-muted/40">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                    <span className="font-medium">Connected</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {connection.company_name ?? `Realm: ${connection.realm_id}`}
                  </p>
                  {connection.last_sync_at && (
                    <p className="text-xs text-muted-foreground">
                      Last synced:{" "}
                      {new Date(connection.last_sync_at).toLocaleString()}
                    </p>
                  )}
                  {connection.sync_error && (
                    <div className="flex items-center gap-1 text-sm text-red-500">
                      <AlertCircle className="h-4 w-4" />
                      {connection.sync_error}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Select value={syncMonth} onValueChange={setSyncMonth}>
                    <SelectTrigger className="w-[120px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[
                        "January", "February", "March", "April", "May", "June",
                        "July", "August", "September", "October", "November", "December",
                      ].map((m, i) => (
                        <SelectItem key={i + 1} value={String(i + 1)}>
                          {m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={syncYear} onValueChange={setSyncYear}>
                    <SelectTrigger className="w-[90px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[currentPeriod.year - 2, currentPeriod.year - 1, currentPeriod.year, currentPeriod.year + 1].map(
                        (y) => (
                          <SelectItem key={y} value={String(y)}>
                            {y}
                          </SelectItem>
                        )
                      )}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    onClick={handleSync}
                    disabled={syncing}
                  >
                    <RefreshCw
                      className={`mr-2 h-4 w-4 ${
                        syncing ? "animate-spin" : ""
                      }`}
                    />
                    {syncing ? "Syncing..." : "Sync Period"}
                  </Button>
                  <Button variant="destructive" onClick={handleDisconnect}>
                    <Unlink className="mr-2 h-4 w-4" />
                    Disconnect
                  </Button>
                </div>
              </div>

              {syncLogs.length > 0 && (
                <div>
                  <h3 className="font-medium mb-2">Sync History</h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Type</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Records</TableHead>
                        <TableHead>Started</TableHead>
                        <TableHead>Duration</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {syncLogs.map((log) => (
                        <TableRow key={log.id}>
                          <TableCell className="capitalize">
                            {log.sync_type}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                log.status === "completed"
                                  ? "default"
                                  : log.status === "failed"
                                  ? "destructive"
                                  : "secondary"
                              }
                            >
                              {log.status}
                            </Badge>
                          </TableCell>
                          <TableCell>{log.records_synced}</TableCell>
                          <TableCell>
                            {new Date(log.started_at).toLocaleString()}
                          </TableCell>
                          <TableCell>
                            {log.completed_at
                              ? `${Math.round(
                                  (new Date(log.completed_at).getTime() -
                                    new Date(log.started_at).getTime()) /
                                    1000
                                )}s`
                              : "---"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center py-8">
              <Link2 className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground mb-4">
                Not connected to QuickBooks Online
              </p>
              <Button onClick={handleConnect}>
                <Link2 className="mr-2 h-4 w-4" />
                Connect to QuickBooks
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Drift Monitoring */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5" />
                Balance Drift Monitoring
              </CardTitle>
              <CardDescription>
                Select accounts to monitor for unexpected balance changes between
                daily syncs. You&apos;ll be alerted on the dashboard when a monitored
                account&apos;s ending balance changes.
              </CardDescription>
            </div>
            {monitoredAccountIds.size > 0 && (
              <Badge variant="secondary">
                {monitoredAccountIds.size} monitored
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {accounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No accounts found. Sync from QuickBooks first.
            </p>
          ) : (
            <div className="space-y-4">
              {/* Currently Monitored Summary */}
              {monitoredAccountIds.size > 0 && (
                <div className="rounded-md border bg-muted/30 p-4 space-y-2">
                  <h4 className="text-sm font-medium flex items-center gap-2">
                    <Activity className="h-4 w-4 text-green-500" />
                    Currently Monitoring ({monitoredAccountIds.size} account{monitoredAccountIds.size !== 1 ? "s" : ""})
                  </h4>
                  <p className="text-xs text-muted-foreground mb-2">
                    Checked daily across all months (prior Dec – current month) for balance changes.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {accounts
                      .filter((a) => monitoredAccountIds.has(a.id))
                      .map((a) => (
                        <Badge
                          key={a.id}
                          variant="secondary"
                          className="cursor-pointer hover:bg-destructive/20 hover:text-destructive transition-colors"
                          onClick={() => toggleMonitoredAccount(a.id)}
                          title="Click to remove"
                        >
                          {a.account_number ? `#${a.account_number} ` : ""}{a.name}
                          <X className="ml-1 h-3 w-3" />
                        </Badge>
                      ))}
                  </div>
                </div>
              )}

              <Input
                placeholder="Filter accounts..."
                value={driftFilter}
                onChange={(e) => setDriftFilter(e.target.value)}
                className="max-w-sm"
              />

              <div className="max-h-[400px] overflow-y-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[50px]">Monitor</TableHead>
                      <TableHead>Account</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Classification</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(() => {
                      const filtered = accounts.filter((a) => {
                        if (!driftFilter) return true;
                        const term = driftFilter.toLowerCase();
                        return (
                          a.name.toLowerCase().includes(term) ||
                          (a.account_number ?? "").toLowerCase().includes(term) ||
                          a.account_type.toLowerCase().includes(term) ||
                          a.classification.toLowerCase().includes(term)
                        );
                      });

                      // Group by classification
                      const groups: Record<string, Account[]> = {};
                      for (const a of filtered) {
                        (groups[a.classification] ??= []).push(a);
                      }

                      const classificationOrder = ["Asset", "Liability", "Equity", "Revenue", "Expense"];

                      return classificationOrder
                        .filter((c) => groups[c]?.length)
                        .flatMap((classification) => [
                          <TableRow key={`group-${classification}`} className="bg-muted/50">
                            <TableCell colSpan={4} className="font-semibold text-xs uppercase tracking-wide py-2">
                              {classification}
                            </TableCell>
                          </TableRow>,
                          ...groups[classification].map((account) => (
                            <TableRow
                              key={account.id}
                              className="cursor-pointer hover:bg-muted/30"
                              onClick={() => toggleMonitoredAccount(account.id)}
                            >
                              <TableCell>
                                <Checkbox
                                  checked={monitoredAccountIds.has(account.id)}
                                  onCheckedChange={() => toggleMonitoredAccount(account.id)}
                                />
                              </TableCell>
                              <TableCell>
                                <div>
                                  <span className="font-medium">{account.name}</span>
                                  {account.account_number && (
                                    <span className="ml-2 text-xs text-muted-foreground">
                                      #{account.account_number}
                                    </span>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {account.account_type}
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className="text-xs">
                                  {account.classification}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          )),
                        ]);
                    })()}
                  </TableBody>
                </Table>
              </div>

              <div className="flex justify-end">
                <Button onClick={handleSaveDriftMonitoring} disabled={driftSaving}>
                  {driftSaving ? "Saving..." : "Save Monitoring Settings"}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Danger Zone */}
      <Card className="border-red-200 dark:border-red-900">
        <CardHeader>
          <CardTitle className="text-red-600 dark:text-red-400">
            Danger Zone
          </CardTitle>
          <CardDescription>
            Permanently delete this entity and all of its data. This action
            cannot be undone.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-red-200 dark:border-red-900 p-4 space-y-4">
            <div className="space-y-2">
              <p className="text-sm font-medium">
                Delete &ldquo;{entityName || "this entity"}&rdquo;
              </p>
              <p className="text-sm text-muted-foreground">
                This will permanently delete the entity and all associated data
                including accounts, GL balances, trial balances, close periods,
                fixed assets, depreciation schedules, revenue accruals,
                payroll accruals, reports, and any QuickBooks connection.
              </p>
            </div>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Type <span className="font-semibold text-foreground">{entityName}</span> to
                confirm:
              </p>
              <Input
                placeholder="Entity name"
                value={deleteConfirmation}
                onChange={(e) => setDeleteConfirmation(e.target.value)}
                className="max-w-sm"
              />
            </div>
            <Button
              variant="destructive"
              onClick={handleDeleteEntity}
              disabled={deleting || deleteConfirmation !== entityName || !entityName}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {deleting ? "Deleting..." : "Delete Entity"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
