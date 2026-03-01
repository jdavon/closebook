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
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Plus, X, Loader2, Save } from "lucide-react";
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Input for adding new I-code
  const [newICode, setNewICode] = useState("");
  const [newDescription, setNewDescription] = useState("");

  const loadData = useCallback(async () => {
    try {
      const res = await fetch("/api/rebates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get_config", entityId }),
      });
      const data = await res.json();
      setGlobalICodes(data.globalExcludedICodes || []);
    } finally {
      setLoading(false);
    }
  }, [entityId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const addICode = () => {
    const code = newICode.trim();
    if (!code) return;
    if (globalICodes.some((ic) => ic.i_code === code)) {
      toast.error("I-Code already in list");
      return;
    }
    setGlobalICodes((prev) => [
      ...prev,
      { i_code: code, description: newDescription.trim() || null },
    ]);
    setNewICode("");
    setNewDescription("");
  };

  const removeICode = (iCode: string) => {
    setGlobalICodes((prev) => prev.filter((ic) => ic.i_code !== iCode));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/rebates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "upsert_excluded_icodes",
          entityId,
          icodes: globalICodes.map((ic) => ({
            i_code: ic.i_code,
            description: ic.description,
          })),
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Global excluded I-Codes saved");
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
          {/* Current I-codes as tags */}
          <div className="flex flex-wrap gap-2">
            {globalICodes.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No excluded I-Codes configured.
              </p>
            ) : (
              globalICodes.map((ic) => (
                <Badge
                  key={ic.i_code}
                  variant="secondary"
                  className="px-3 py-1 text-sm"
                >
                  <span className="font-mono">{ic.i_code}</span>
                  {ic.description && (
                    <span className="text-muted-foreground ml-1">
                      ({ic.description})
                    </span>
                  )}
                  <button
                    className="ml-2 hover:text-destructive"
                    onClick={() => removeICode(ic.i_code)}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))
            )}
          </div>

          {/* Add new I-code */}
          <div className="flex gap-2 items-end">
            <div className="space-y-1">
              <Label className="text-xs">I-Code</Label>
              <Input
                value={newICode}
                onChange={(e) => setNewICode(e.target.value)}
                placeholder="e.g., 100305"
                className="w-32"
                onKeyDown={(e) => e.key === "Enter" && addICode()}
              />
            </div>
            <div className="space-y-1 flex-1">
              <Label className="text-xs">Description (optional)</Label>
              <Input
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="What this I-Code is for..."
                onKeyDown={(e) => e.key === "Enter" && addICode()}
              />
            </div>
            <Button variant="outline" onClick={addICode}>
              <Plus className="mr-1 h-4 w-4" />
              Add
            </Button>
          </div>

          {/* Save button */}
          <div className="pt-2">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save Excluded I-Codes
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
