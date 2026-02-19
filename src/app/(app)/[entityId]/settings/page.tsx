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
import { RefreshCw, Link2, Unlink, CheckCircle2, AlertCircle, Trash2 } from "lucide-react";
import { getCurrentPeriod, getPeriodLabel } from "@/lib/utils/dates";

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
