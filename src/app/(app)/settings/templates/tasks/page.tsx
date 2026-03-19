"use client";

import { useState, useEffect, useCallback } from "react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Plus, Trash2, Zap } from "lucide-react";
import { CLOSE_PHASES, AUTO_DISCOVERY_MODULES } from "@/lib/utils/close-management";
import type { ClosePhase } from "@/lib/types/database";

interface TaskTemplate {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  account_classification: string | null;
  account_type: string | null;
  relative_due_day: number | null;
  requires_reconciliation: boolean;
  is_active: boolean;
  phase: number;
  source_module: string | null;
}

const PHASE_LABELS: Record<ClosePhase, string> = {
  1: "Phase 1: Pre-Close",
  2: "Phase 2: Adjustments",
  3: "Phase 3: Reconciliations",
  4: "Phase 4: Review & Reporting",
};

export default function TaskTemplatesPage() {
  const supabase = createClient();
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [accountClassification, setAccountClassification] = useState("");
  const [relativeDueDay, setRelativeDueDay] = useState("5");
  const [requiresReconciliation, setRequiresReconciliation] = useState(false);
  const [phase, setPhase] = useState<string>("3");
  const [creating, setCreating] = useState(false);

  const loadTemplates = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data: membership } = await supabase
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", user.id)
      .single();

    if (!membership) return;

    const { data } = await supabase
      .from("close_task_templates")
      .select("*")
      .eq("organization_id", membership.organization_id)
      .order("phase")
      .order("display_order")
      .order("name");

    setTemplates((data as TaskTemplate[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setCreating(false);
      return;
    }

    const { data: membership } = await supabase
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", user.id)
      .single();

    if (!membership) {
      toast.error("No organization found");
      setCreating(false);
      return;
    }

    const { error } = await supabase.from("close_task_templates").insert({
      organization_id: membership.organization_id,
      name,
      description: description || null,
      category: category || null,
      account_classification: accountClassification || null,
      relative_due_day: parseInt(relativeDueDay) || 5,
      requires_reconciliation: requiresReconciliation,
      display_order: templates.length,
      phase: parseInt(phase) || 3,
    });

    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Template created");
      setName("");
      setDescription("");
      setCategory("");
      setAccountClassification("");
      setRequiresReconciliation(false);
      setPhase("3");
      loadTemplates();
    }

    setCreating(false);
  }

  async function handleDelete(id: string) {
    const { error } = await supabase
      .from("close_task_templates")
      .delete()
      .eq("id", id);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Template deleted");
      loadTemplates();
    }
  }

  // Group templates by phase for display
  const groupedTemplates = templates.reduce(
    (acc, tpl) => {
      const p = (tpl.phase || 3) as ClosePhase;
      if (!acc[p]) acc[p] = [];
      acc[p].push(tpl);
      return acc;
    },
    {} as Record<ClosePhase, TaskTemplate[]>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Close Task Templates
        </h1>
        <p className="text-muted-foreground">
          Define reusable task templates that auto-generate when you initialize a
          close period
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add Template</CardTitle>
          <CardDescription>
            Templates linked to an account classification will create one task
            per matching account. Phase determines when the task is available during the close.
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleCreate}>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="tplName">Task Name</Label>
                <Input
                  id="tplName"
                  placeholder="e.g., Bank Reconciliation"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tplCategory">Category</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger id="tplCategory">
                    <SelectValue placeholder="Select..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Reconciliation">
                      Reconciliation
                    </SelectItem>
                    <SelectItem value="Accruals">Accruals</SelectItem>
                    <SelectItem value="Journal Entries">
                      Journal Entries
                    </SelectItem>
                    <SelectItem value="Review">Review</SelectItem>
                    <SelectItem value="Reporting">Reporting</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="tplPhase">Phase</Label>
                <Select value={phase} onValueChange={setPhase}>
                  <SelectTrigger id="tplPhase">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 — Pre-Close</SelectItem>
                    <SelectItem value="2">2 — Adjustments</SelectItem>
                    <SelectItem value="3">3 — Reconciliations</SelectItem>
                    <SelectItem value="4">4 — Review & Reporting</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="tplClassification">
                  Account Classification
                </Label>
                <Select
                  value={accountClassification}
                  onValueChange={setAccountClassification}
                >
                  <SelectTrigger id="tplClassification">
                    <SelectValue placeholder="All accounts..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Asset">Asset</SelectItem>
                    <SelectItem value="Liability">Liability</SelectItem>
                    <SelectItem value="Equity">Equity</SelectItem>
                    <SelectItem value="Revenue">Revenue</SelectItem>
                    <SelectItem value="Expense">Expense</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="tplDueDay">
                  Due Day (days after period end)
                </Label>
                <Input
                  id="tplDueDay"
                  type="number"
                  min="1"
                  max="30"
                  value={relativeDueDay}
                  onChange={(e) => setRelativeDueDay(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="tplDescription">Description</Label>
              <Input
                id="tplDescription"
                placeholder="Optional description..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="tplReconciliation"
                checked={requiresReconciliation}
                onCheckedChange={(checked) =>
                  setRequiresReconciliation(checked === true)
                }
              />
              <Label htmlFor="tplReconciliation">
                Requires reconciliation (GL balance vs. supporting schedule)
              </Label>
            </div>
            <Button type="submit" disabled={creating}>
              <Plus className="mr-2 h-4 w-4" />
              {creating ? "Creating..." : "Add Template"}
            </Button>
          </CardContent>
        </form>
      </Card>

      {/* Auto-discovered tasks info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-yellow-500" />
            Auto-Discovered Tasks
          </CardTitle>
          <CardDescription>
            These tasks are automatically generated when initializing a close
            period, based on active data in each entity. They don&apos;t need templates.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Module</TableHead>
                <TableHead>Phase</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Description</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {AUTO_DISCOVERY_MODULES.map((mod) => (
                <TableRow key={mod.sourceModule}>
                  <TableCell className="font-medium capitalize">
                    {mod.sourceModule === "tb"
                      ? "Trial Balance"
                      : mod.sourceModule === "financial_statements"
                      ? "Financial Statements"
                      : mod.sourceModule.replace("_", " ")}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">
                      {CLOSE_PHASES[mod.phase].name}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">
                      {mod.category}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {mod.description}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Template list grouped by phase */}
      <Card>
        <CardHeader>
          <CardTitle>Templates</CardTitle>
          <CardDescription>
            {templates.length} template{templates.length !== 1 ? "s" : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : templates.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No templates yet. Add your first template above.
            </p>
          ) : (
            <div className="space-y-6">
              {([1, 2, 3, 4] as ClosePhase[]).map((p) => {
                const phaseTpls = groupedTemplates[p];
                if (!phaseTpls || phaseTpls.length === 0) return null;

                return (
                  <div key={p}>
                    <h3 className="text-sm font-medium text-muted-foreground mb-2">
                      {PHASE_LABELS[p]}
                    </h3>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Category</TableHead>
                          <TableHead>Account Class</TableHead>
                          <TableHead>Due Day</TableHead>
                          <TableHead>Reconciliation</TableHead>
                          <TableHead></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {phaseTpls.map((tpl) => (
                          <TableRow key={tpl.id}>
                            <TableCell className="font-medium">
                              {tpl.name}
                            </TableCell>
                            <TableCell>
                              {tpl.category && (
                                <Badge variant="outline">{tpl.category}</Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {tpl.account_classification ?? "All"}
                            </TableCell>
                            <TableCell>
                              {tpl.relative_due_day
                                ? `+${tpl.relative_due_day} days`
                                : "---"}
                            </TableCell>
                            <TableCell>
                              {tpl.requires_reconciliation ? "Yes" : "No"}
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDelete(tpl.id)}
                              >
                                <Trash2 className="h-4 w-4 text-muted-foreground" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
