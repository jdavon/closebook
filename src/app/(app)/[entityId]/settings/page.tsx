"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
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
import { RefreshCw, Link2, Unlink, CheckCircle2, AlertCircle } from "lucide-react";

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
  const entityId = params.entityId as string;
  const supabase = createClient();

  const [connection, setConnection] = useState<QboConnection | null>(null);
  const [syncLogs, setSyncLogs] = useState<SyncLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

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
    try {
      const response = await fetch("/api/qbo/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityId, syncType: "full" }),
      });

      const data = await response.json();

      if (response.ok) {
        toast.success("Sync completed successfully");
        loadData();
      } else {
        toast.error(data.error || "Sync failed");
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
                <div className="flex gap-2">
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
                    {syncing ? "Syncing..." : "Sync Now"}
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
    </div>
  );
}
