"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  Upload,
  FileText,
  Send,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  ExternalLink,
  Lock,
  Zap,
  RefreshCw,
  ShieldAlert,
  ClipboardList,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils/dates";
import {
  CLOSE_PHASES,
  getSourceModuleUrl,
  getSourceModuleLabel,
  computePhaseBlocking,
} from "@/lib/utils/close-management";
import type { TaskStatus, ClosePhase, CloseSourceModule, ReconciliationFieldDef } from "@/lib/types/database";

interface TaskDetail {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  status: TaskStatus;
  preparer_notes: string | null;
  reviewer_notes: string | null;
  gl_balance: number | null;
  reconciled_balance: number | null;
  variance: number | null;
  phase: number;
  source_module: string | null;
  source_record_id: string | null;
  is_auto_generated: boolean;
  is_immaterial: boolean;
  immaterial_reason: string | null;
  reconciliation_template_id: string | null;
  accounts?: { name: string; account_number: string | null } | null;
}

interface ReconciliationTemplate {
  id: string;
  name: string;
  field_definitions: ReconciliationFieldDef[];
  variance_tolerance_amount: number | null;
  variance_tolerance_percentage: number | null;
}

interface WorkpaperData {
  id: string;
  status: string;
  workpaper_data: Record<string, unknown>;
  gl_balance: number | null;
  subledger_balance: number | null;
  variance: number | null;
  notes: string | null;
}

interface Comment {
  id: string;
  content: string;
  created_at: string;
  profiles: { full_name: string } | null;
}

interface Attachment {
  id: string;
  file_name: string;
  file_path: string;
  file_size: number | null;
  created_at: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SourceStatusData = Record<string, any>;

interface JELine {
  account: string;
  accountId?: string;
  amount: number;
}

interface JEEntry {
  source: string;
  sourceRecordId?: string;
  sourceRecordName: string;
  date: string;
  description: string;
  debits: JELine[];
  credits: JELine[];
}

interface JEWorksheetData {
  module: string;
  entries: JEEntry[];
  totalDebit: number;
  totalCredit: number;
  message?: string;
}

const JE_MODULE_MAP: Record<string, string> = {
  debt: "debt",
  assets: "depreciation",
  leases: "leases",
  payroll: "payroll",
};

export default function TaskDetailPage() {
  const params = useParams();
  const router = useRouter();
  const entityId = params.entityId as string;
  const periodId = params.periodId as string;
  const taskId = params.taskId as string;
  const supabase = createClient();

  const [task, setTask] = useState<TaskDetail | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [reconciledBalance, setReconciledBalance] = useState("");
  const [newComment, setNewComment] = useState("");
  const [preparerNotes, setPreparerNotes] = useState("");
  const [reviewerNotes, setReviewerNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sourceStatus, setSourceStatus] = useState<SourceStatusData | null>(
    null
  );
  const [sourceLoading, setSourceLoading] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);
  const [jeWorksheet, setJeWorksheet] = useState<JEWorksheetData | null>(null);
  const [jeLoading, setJeLoading] = useState(false);

  // Materiality waiver state
  const [showWaiverForm, setShowWaiverForm] = useState(false);
  const [waiverReason, setWaiverReason] = useState("");
  const [waiverSaving, setWaiverSaving] = useState(false);

  // Workpaper state
  const [reconTemplate, setReconTemplate] = useState<ReconciliationTemplate | null>(null);
  const [workpaper, setWorkpaper] = useState<WorkpaperData | null>(null);
  const [wpFieldValues, setWpFieldValues] = useState<Record<string, unknown>>({});
  const [wpGlBalance, setWpGlBalance] = useState("");
  const [wpSubBalance, setWpSubBalance] = useState("");
  const [wpNotes, setWpNotes] = useState("");
  const [wpSaving, setWpSaving] = useState(false);
  const [allTemplates, setAllTemplates] = useState<ReconciliationTemplate[]>([]);

  const loadTask = useCallback(async () => {
    const taskResult = await supabase
      .from("close_tasks")
      .select("*, accounts(name, account_number)")
      .eq("id", taskId)
      .single();

    const commentsResult = await supabase
      .from("close_task_comments")
      .select("*, profiles(full_name)")
      .eq("close_task_id", taskId)
      .order("created_at");

    const attachmentsResult = await supabase
      .from("close_task_attachments")
      .select("*")
      .eq("close_task_id", taskId)
      .order("created_at", { ascending: false });

    const taskData = taskResult.data as unknown as TaskDetail;
    setTask(taskData);
    setComments((commentsResult.data as unknown as Comment[]) ?? []);
    setAttachments((attachmentsResult.data as Attachment[]) ?? []);

    if (taskData) {
      setReconciledBalance(
        taskData.reconciled_balance?.toString() ?? ""
      );
      setPreparerNotes(taskData.preparer_notes ?? "");
      setReviewerNotes(taskData.reviewer_notes ?? "");

      // Check phase blocking
      const { data: allTasks } = await supabase
        .from("close_tasks")
        .select("phase, status")
        .eq("close_period_id", periodId);

      if (allTasks) {
        const blocking = computePhaseBlocking(allTasks);
        setIsBlocked(blocking[taskData.phase as ClosePhase] ?? false);
      }
    }

    setLoading(false);
  }, [supabase, taskId, periodId]);

  useEffect(() => {
    loadTask();
  }, [loadTask]);

  // Load source module status
  const loadSourceStatus = useCallback(async () => {
    if (!task?.source_module) return;
    setSourceLoading(true);
    try {
      const res = await fetch(
        `/api/close/task-source-status?taskId=${taskId}`
      );
      const data = await res.json();
      if (res.ok) {
        setSourceStatus(data);
      }
    } catch {
      // Silently fail — source status is optional
    }
    setSourceLoading(false);
  }, [task?.source_module, taskId]);

  useEffect(() => {
    if (task?.source_module) {
      loadSourceStatus();
    }
  }, [task?.source_module, loadSourceStatus]);

  // Load JE worksheet for computation-engine modules
  const loadJeWorksheet = useCallback(async () => {
    if (!task?.source_module) return;
    const jeModule = JE_MODULE_MAP[task.source_module];
    if (!jeModule) return;

    setJeLoading(true);
    try {
      // Need period year/month — fetch from close_periods
      const { data: period } = await supabase
        .from("close_periods")
        .select("period_year, period_month, entity_id")
        .eq("id", periodId)
        .single();

      if (!period) return;

      const res = await fetch(
        `/api/close/je-worksheet?entityId=${period.entity_id}&periodYear=${period.period_year}&periodMonth=${period.period_month}&module=${jeModule}`
      );
      const data = await res.json();
      if (res.ok) {
        setJeWorksheet(data);
      }
    } catch {
      // Silently fail
    }
    setJeLoading(false);
  }, [task?.source_module, periodId, supabase]);

  useEffect(() => {
    if (task?.source_module && JE_MODULE_MAP[task.source_module]) {
      loadJeWorksheet();
    }
  }, [task?.source_module, loadJeWorksheet]);

  // Load reconciliation template and workpaper
  const loadWorkpaperData = useCallback(async () => {
    // Load all templates for selector
    try {
      const templatesRes = await fetch("/api/close/reconciliation-templates");
      const templatesData = await templatesRes.json();
      setAllTemplates(templatesData.templates ?? []);
    } catch {
      // ignore
    }

    // Load existing workpaper for this task
    try {
      const wpRes = await fetch(`/api/close/workpapers?taskId=${taskId}`);
      const wpData = await wpRes.json();
      if (wpData.workpaper) {
        setWorkpaper(wpData.workpaper);
        setWpFieldValues(wpData.workpaper.workpaper_data ?? {});
        setWpGlBalance(wpData.workpaper.gl_balance?.toString() ?? "");
        setWpSubBalance(wpData.workpaper.subledger_balance?.toString() ?? "");
        setWpNotes(wpData.workpaper.notes ?? "");
      }
    } catch {
      // ignore
    }
  }, [taskId]);

  useEffect(() => {
    if (task) {
      loadWorkpaperData();
    }
  }, [task, loadWorkpaperData]);

  // Set template when task has reconciliation_template_id or workpaper has one
  useEffect(() => {
    const templateId = task?.reconciliation_template_id ?? undefined;
    if (templateId && allTemplates.length > 0) {
      const tmpl = allTemplates.find((t) => t.id === templateId);
      if (tmpl) setReconTemplate(tmpl);
    }
  }, [task?.reconciliation_template_id, allTemplates]);

  async function handleSaveReconciliation() {
    setSaving(true);
    const reconciled = reconciledBalance
      ? parseFloat(reconciledBalance)
      : null;
    const variance =
      task?.gl_balance !== null && reconciled !== null
        ? task!.gl_balance! - reconciled
        : null;

    const { error } = await supabase
      .from("close_tasks")
      .update({
        reconciled_balance: reconciled,
        variance,
        preparer_notes: preparerNotes || null,
        reviewer_notes: reviewerNotes || null,
      })
      .eq("id", taskId);

    if (error) {
      toast.error(error.message);
    } else {
      setTask((prev) =>
        prev ? { ...prev, reconciled_balance: reconciled, variance } : null
      );
      toast.success("Saved");
    }
    setSaving(false);
  }

  async function handleStatusChange(newStatus: TaskStatus) {
    if (isBlocked) {
      toast.error("This task is blocked. Complete earlier phase tasks first.");
      return;
    }

    const { error } = await supabase
      .from("close_tasks")
      .update({
        status: newStatus,
        ...(newStatus === "pending_review"
          ? { completed_at: new Date().toISOString() }
          : {}),
        ...(newStatus === "approved"
          ? { reviewed_at: new Date().toISOString() }
          : {}),
      })
      .eq("id", taskId);

    if (error) {
      toast.error(error.message);
    } else {
      setTask((prev) => (prev ? { ...prev, status: newStatus } : null));
      toast.success(`Status changed to ${newStatus.replace("_", " ")}`);
    }
  }

  async function handleAddComment() {
    if (!newComment.trim()) return;

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase.from("close_task_comments").insert({
      close_task_id: taskId,
      user_id: user.id,
      content: newComment.trim(),
    });

    if (error) {
      toast.error(error.message);
    } else {
      setNewComment("");
      loadTask();
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    for (const file of Array.from(files)) {
      const filePath = `${entityId}/${periodId}/${taskId}/${Date.now()}_${file.name}`;

      const { error: uploadError } = await supabase.storage
        .from("close-attachments")
        .upload(filePath, file);

      if (uploadError) {
        toast.error(`Failed to upload ${file.name}: ${uploadError.message}`);
        continue;
      }

      const { error: dbError } = await supabase
        .from("close_task_attachments")
        .insert({
          close_task_id: taskId,
          file_name: file.name,
          file_path: filePath,
          file_size: file.size,
          mime_type: file.type,
          uploaded_by: user.id,
        });

      if (dbError) {
        toast.error(`Failed to save ${file.name}: ${dbError.message}`);
      }
    }

    toast.success("File(s) uploaded");
    loadTask();
    e.target.value = "";
  }

  async function handleWaiveImmaterial() {
    if (!waiverReason.trim()) {
      toast.error("Please provide a reason for the waiver");
      return;
    }
    setWaiverSaving(true);
    try {
      const res = await fetch("/api/close/materiality-override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: taskId,
          justification: waiverReason.trim(),
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        toast.error(err.error || "Failed to waive variance");
      } else {
        toast.success("Variance waived as immaterial");
        setShowWaiverForm(false);
        setWaiverReason("");
        setTask((prev) =>
          prev ? { ...prev, is_immaterial: true, immaterial_reason: waiverReason.trim() } : null
        );
      }
    } catch {
      toast.error("Failed to waive variance");
    }
    setWaiverSaving(false);
  }

  async function handleSaveWorkpaper() {
    if (!reconTemplate) return;
    setWpSaving(true);

    const glBal = wpGlBalance ? parseFloat(wpGlBalance) : null;
    const subBal = wpSubBalance ? parseFloat(wpSubBalance) : null;
    const variance = glBal != null && subBal != null ? glBal - subBal : null;

    try {
      if (workpaper) {
        // Update
        const res = await fetch("/api/close/workpapers", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: workpaper.id,
            fieldValues: wpFieldValues,
            glBalance: glBal,
            subBalance: subBal,
            variance,
            notes: wpNotes || null,
          }),
        });
        if (!res.ok) {
          const err = await res.json();
          toast.error(err.error || "Failed to update workpaper");
        } else {
          toast.success("Workpaper saved");
          setWorkpaper((prev) => prev ? { ...prev, gl_balance: glBal, subledger_balance: subBal, variance, notes: wpNotes || null, workpaper_data: wpFieldValues } : null);
        }
      } else {
        // Create
        const res = await fetch("/api/close/workpapers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            closeTaskId: taskId,
            templateId: reconTemplate.id,
            fieldValues: wpFieldValues,
            glBalance: glBal,
            subBalance: subBal,
            variance,
            notes: wpNotes || null,
          }),
        });
        if (!res.ok) {
          const err = await res.json();
          toast.error(err.error || "Failed to create workpaper");
        } else {
          const data = await res.json();
          toast.success("Workpaper created");
          setWorkpaper(data.workpaper);
        }
      }
    } catch {
      toast.error("Failed to save workpaper");
    }
    setWpSaving(false);
  }

  async function handleSubmitWorkpaper() {
    if (!workpaper) return;
    setWpSaving(true);
    try {
      const res = await fetch("/api/close/workpapers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: workpaper.id, status: "submitted" }),
      });
      if (res.ok) {
        toast.success("Workpaper submitted for review");
        setWorkpaper((prev) => prev ? { ...prev, status: "submitted" } : null);
      }
    } catch {
      toast.error("Failed to submit workpaper");
    }
    setWpSaving(false);
  }

  if (loading) return <p className="text-muted-foreground">Loading...</p>;
  if (!task) return <p className="text-muted-foreground">Task not found</p>;

  const varianceClass =
    task.variance === null
      ? ""
      : task.variance === 0
      ? "text-green-600"
      : "text-red-600";

  const phaseInfo = CLOSE_PHASES[task.phase as ClosePhase];
  const moduleUrl = task.source_module
    ? getSourceModuleUrl(entityId, task.source_module as CloseSourceModule)
    : null;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push(`/${entityId}/close/${periodId}`)}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
      </div>

      {/* Blocked Banner */}
      {isBlocked && (
        <div className="flex items-center gap-3 p-4 rounded-lg border border-yellow-200 bg-yellow-50 dark:bg-yellow-950/20 dark:border-yellow-800">
          <Lock className="h-5 w-5 text-yellow-600 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
              This task is blocked
            </p>
            <p className="text-xs text-yellow-700 dark:text-yellow-300">
              Complete all tasks in earlier phases to unlock this task.
            </p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {task.name}
            </h1>
            {task.is_auto_generated && (
              <span title="Auto-generated from module">
                <Zap className="h-4 w-4 text-yellow-500" />
              </span>
            )}
          </div>
          {task.accounts && (
            <p className="text-muted-foreground">
              {task.accounts.account_number} - {task.accounts.name}
            </p>
          )}
          <div className="flex items-center gap-2 mt-1">
            {task.category && (
              <Badge variant="outline">{task.category}</Badge>
            )}
            {phaseInfo && (
              <Badge variant="outline" className="text-xs">
                Phase {task.phase}: {phaseInfo.name}
              </Badge>
            )}
            {task.source_module && moduleUrl && (
              <Link href={moduleUrl}>
                <Badge
                  variant="secondary"
                  className="text-xs cursor-pointer hover:bg-secondary/80"
                >
                  <ExternalLink className="mr-1 h-3 w-3" />
                  {getSourceModuleLabel(
                    task.source_module as CloseSourceModule
                  )}
                </Badge>
              </Link>
            )}
          </div>
        </div>
        {!isBlocked && (
          <div className="flex gap-2">
            {task.status === "not_started" && (
              <Button onClick={() => handleStatusChange("in_progress")}>
                <Clock className="mr-2 h-4 w-4" />
                Start Working
              </Button>
            )}
            {task.status === "in_progress" && (
              <Button onClick={() => handleStatusChange("pending_review")}>
                <Send className="mr-2 h-4 w-4" />
                Submit for Review
              </Button>
            )}
            {task.status === "pending_review" && (
              <>
                <Button
                  variant="destructive"
                  onClick={() => handleStatusChange("rejected")}
                >
                  <XCircle className="mr-2 h-4 w-4" />
                  Reject
                </Button>
                <Button onClick={() => handleStatusChange("approved")}>
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Approve
                </Button>
              </>
            )}
            {task.status === "rejected" && (
              <Button onClick={() => handleStatusChange("in_progress")}>
                <Clock className="mr-2 h-4 w-4" />
                Reopen
              </Button>
            )}
          </div>
        )}
      </div>

      {task.description && (
        <p className="text-muted-foreground">{task.description}</p>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {/* Left column: Reconciliation + Source Module Status */}
        <div className="space-y-6">
          {/* Reconciliation */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Reconciliation</CardTitle>
              <CardDescription>
                Compare GL balance with reconciled balance
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>GL Balance</Label>
                <div className="text-lg font-semibold tabular-nums">
                  {task.gl_balance !== null
                    ? formatCurrency(task.gl_balance)
                    : "Not synced"}
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="reconciled">Reconciled Balance</Label>
                <Input
                  id="reconciled"
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={reconciledBalance}
                  onChange={(e) => setReconciledBalance(e.target.value)}
                  disabled={isBlocked}
                />
              </div>
              {task.variance !== null && (
                <div className="space-y-2">
                  <Label>Variance</Label>
                  <div
                    className={`text-lg font-semibold tabular-nums ${varianceClass}`}
                  >
                    {formatCurrency(task.variance)}
                    {task.variance === 0 && (
                      <CheckCircle2 className="inline ml-2 h-5 w-5" />
                    )}
                  </div>
                </div>
              )}
              <Separator />
              <div className="space-y-2">
                <Label htmlFor="preparerNotes">Preparer Notes</Label>
                <Textarea
                  id="preparerNotes"
                  placeholder="Add notes about the reconciliation..."
                  value={preparerNotes}
                  onChange={(e) => setPreparerNotes(e.target.value)}
                  rows={3}
                  disabled={isBlocked}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reviewerNotes">Reviewer Notes</Label>
                <Textarea
                  id="reviewerNotes"
                  placeholder="Reviewer feedback..."
                  value={reviewerNotes}
                  onChange={(e) => setReviewerNotes(e.target.value)}
                  rows={3}
                  disabled={isBlocked}
                />
              </div>
              <Button
                onClick={handleSaveReconciliation}
                disabled={saving || isBlocked}
              >
                {saving ? "Saving..." : "Save"}
              </Button>
            </CardContent>
          </Card>

          {/* Source Module Status */}
          {task.source_module && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg">Module Status</CardTitle>
                    <CardDescription>
                      Live data from{" "}
                      {getSourceModuleLabel(
                        task.source_module as CloseSourceModule
                      )}
                    </CardDescription>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={loadSourceStatus}
                    disabled={sourceLoading}
                  >
                    <RefreshCw
                      className={`h-4 w-4 ${sourceLoading ? "animate-spin" : ""}`}
                    />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {sourceLoading && !sourceStatus ? (
                  <p className="text-sm text-muted-foreground">Loading...</p>
                ) : sourceStatus?.data ? (
                  <SourceStatusDisplay
                    sourceModule={task.source_module}
                    data={sourceStatus.data}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No module data available
                  </p>
                )}
                {moduleUrl && (
                  <Link href={moduleUrl} className="block mt-3">
                    <Button variant="outline" size="sm" className="w-full">
                      <ExternalLink className="mr-2 h-4 w-4" />
                      Go to{" "}
                      {getSourceModuleLabel(
                        task.source_module as CloseSourceModule
                      )}
                    </Button>
                  </Link>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right column: Attachments & Comments */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Supporting Documents</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label
                  htmlFor="fileUpload"
                  className="flex items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 cursor-pointer hover:border-primary/50 transition-colors"
                >
                  <Upload className="h-5 w-5 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    Click to upload files
                  </span>
                </Label>
                <input
                  id="fileUpload"
                  type="file"
                  multiple
                  className="hidden"
                  onChange={handleFileUpload}
                />
              </div>
              {attachments.length > 0 && (
                <div className="space-y-2">
                  {attachments.map((att) => (
                    <div
                      key={att.id}
                      className="flex items-center gap-2 text-sm p-2 rounded border"
                    >
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <span className="flex-1 truncate">{att.file_name}</span>
                      {att.file_size && (
                        <span className="text-xs text-muted-foreground">
                          {(att.file_size / 1024).toFixed(0)} KB
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Comments</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {comments.length > 0 && (
                <div className="space-y-3 max-h-60 overflow-y-auto">
                  {comments.map((comment) => (
                    <div key={comment.id} className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">
                          {comment.profiles?.full_name ?? "Unknown"}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(comment.created_at).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {comment.content}
                      </p>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <Input
                  placeholder="Add a comment..."
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleAddComment();
                    }
                  }}
                />
                <Button size="sm" onClick={handleAddComment}>
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Materiality Waiver */}
      {task.variance !== null && task.variance !== 0 && !task.is_immaterial && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-yellow-500" />
              Variance Waiver
            </CardTitle>
            <CardDescription>
              If this variance is immaterial, you can waive it with justification.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!showWaiverForm ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowWaiverForm(true)}
                disabled={isBlocked}
              >
                Waive as Immaterial
              </Button>
            ) : (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label>Justification</Label>
                  <Textarea
                    placeholder="Explain why this variance is immaterial..."
                    value={waiverReason}
                    onChange={(e) => setWaiverReason(e.target.value)}
                    rows={3}
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={handleWaiveImmaterial}
                    disabled={waiverSaving || !waiverReason.trim()}
                  >
                    {waiverSaving ? "Saving..." : "Confirm Waiver"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setShowWaiverForm(false);
                      setWaiverReason("");
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Immaterial Badge */}
      {task.is_immaterial && (
        <div className="flex items-center gap-3 p-4 rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-800">
          <ShieldAlert className="h-5 w-5 text-blue-600 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
              Variance waived as immaterial
            </p>
            {task.immaterial_reason && (
              <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                {task.immaterial_reason}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Reconciliation Workpaper */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            Reconciliation Workpaper
          </CardTitle>
          <CardDescription>
            {reconTemplate
              ? `Template: ${reconTemplate.name}`
              : "Select a reconciliation template to fill out a workpaper"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!reconTemplate && (
            <div className="space-y-2">
              <Label>Template</Label>
              <Select
                value=""
                onValueChange={(v) => {
                  const tmpl = allTemplates.find((t) => t.id === v);
                  if (tmpl) setReconTemplate(tmpl);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose a template..." />
                </SelectTrigger>
                <SelectContent>
                  {allTemplates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {reconTemplate && (
            <>
              {workpaper && (
                <Badge
                  variant={
                    workpaper.status === "approved"
                      ? "default"
                      : workpaper.status === "submitted"
                      ? "secondary"
                      : "outline"
                  }
                >
                  {workpaper.status}
                </Badge>
              )}

              {/* Standard fields */}
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label>GL Balance</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={wpGlBalance}
                    onChange={(e) => setWpGlBalance(e.target.value)}
                    disabled={isBlocked || workpaper?.status === "submitted" || workpaper?.status === "approved"}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Sub/Supporting Balance</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={wpSubBalance}
                    onChange={(e) => setWpSubBalance(e.target.value)}
                    disabled={isBlocked || workpaper?.status === "submitted" || workpaper?.status === "approved"}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Variance</Label>
                  <div className="text-lg font-semibold tabular-nums pt-1.5">
                    {wpGlBalance && wpSubBalance
                      ? formatCurrency(parseFloat(wpGlBalance) - parseFloat(wpSubBalance))
                      : "—"}
                  </div>
                </div>
              </div>

              {/* Template custom fields */}
              {reconTemplate.field_definitions.length > 0 && (
                <div className="space-y-3">
                  <Separator />
                  <p className="text-sm font-medium">Custom Fields</p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {reconTemplate.field_definitions.map((field) => (
                      <div key={field.fieldName} className="space-y-2">
                        <Label>
                          {field.fieldLabel}
                          {field.required && <span className="text-red-500 ml-1">*</span>}
                        </Label>
                        {field.fieldType === "select" ? (
                          <Select
                            value={(wpFieldValues[field.fieldName] as string) ?? ""}
                            onValueChange={(v) =>
                              setWpFieldValues((prev) => ({ ...prev, [field.fieldName]: v }))
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder={`Select ${field.fieldLabel}`} />
                            </SelectTrigger>
                            <SelectContent>
                              {(field.options ?? []).map((opt) => (
                                <SelectItem key={opt} value={opt}>
                                  {opt}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : field.fieldType === "date" ? (
                          <Input
                            type="date"
                            value={(wpFieldValues[field.fieldName] as string) ?? ""}
                            onChange={(e) =>
                              setWpFieldValues((prev) => ({ ...prev, [field.fieldName]: e.target.value }))
                            }
                            disabled={isBlocked || workpaper?.status === "submitted" || workpaper?.status === "approved"}
                          />
                        ) : (
                          <Input
                            type={field.fieldType === "currency" || field.fieldType === "number" ? "number" : "text"}
                            step={field.fieldType === "currency" ? "0.01" : undefined}
                            value={(wpFieldValues[field.fieldName] as string) ?? ""}
                            onChange={(e) =>
                              setWpFieldValues((prev) => ({ ...prev, [field.fieldName]: e.target.value }))
                            }
                            disabled={isBlocked || workpaper?.status === "submitted" || workpaper?.status === "approved"}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <Separator />
              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea
                  value={wpNotes}
                  onChange={(e) => setWpNotes(e.target.value)}
                  placeholder="Additional notes..."
                  rows={3}
                  disabled={isBlocked || workpaper?.status === "submitted" || workpaper?.status === "approved"}
                />
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={handleSaveWorkpaper}
                  disabled={wpSaving || isBlocked || workpaper?.status === "submitted" || workpaper?.status === "approved"}
                >
                  {wpSaving ? "Saving..." : workpaper ? "Update Workpaper" : "Save Workpaper"}
                </Button>
                {workpaper && workpaper.status === "draft" && (
                  <Button
                    variant="outline"
                    onClick={handleSubmitWorkpaper}
                    disabled={wpSaving}
                  >
                    <Send className="mr-2 h-4 w-4" />
                    Submit for Review
                  </Button>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* JE Worksheet — full width below the two-column grid */}
      {task.source_module && JE_MODULE_MAP[task.source_module] && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg">Journal Entry Worksheet</CardTitle>
                <CardDescription>
                  Computed entries from{" "}
                  {getSourceModuleLabel(task.source_module as CloseSourceModule)}{" "}
                  engine
                </CardDescription>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={loadJeWorksheet}
                disabled={jeLoading}
              >
                <RefreshCw
                  className={`h-4 w-4 ${jeLoading ? "animate-spin" : ""}`}
                />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {jeLoading && !jeWorksheet ? (
              <p className="text-sm text-muted-foreground">
                Computing journal entries...
              </p>
            ) : jeWorksheet ? (
              <JEWorksheetDisplay data={jeWorksheet} />
            ) : (
              <p className="text-sm text-muted-foreground">
                No journal entry data available
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// JE Worksheet Display Component
// ---------------------------------------------------------------------------

function JEWorksheetDisplay({ data }: { data: JEWorksheetData }) {
  if (data.entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {data.message ?? "No entries to post for this period."}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {data.message && (
        <p className="text-sm text-muted-foreground">{data.message}</p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="pb-2 font-medium">Source</th>
              <th className="pb-2 font-medium">Account</th>
              <th className="pb-2 font-medium text-right">Debit</th>
              <th className="pb-2 font-medium text-right">Credit</th>
            </tr>
          </thead>
          <tbody>
            {data.entries.map((entry, idx) => (
              <JEEntryRows key={idx} entry={entry} isLast={idx === data.entries.length - 1} />
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 font-semibold">
              <td className="pt-2" colSpan={2}>
                Total
              </td>
              <td className="pt-2 text-right tabular-nums">
                {formatCurrency(data.totalDebit)}
              </td>
              <td className="pt-2 text-right tabular-nums">
                {formatCurrency(data.totalCredit)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function JEEntryRows({
  entry,
  isLast,
}: {
  entry: JEEntry;
  isLast: boolean;
}) {
  const rows: React.ReactNode[] = [];

  // Debit lines
  for (let i = 0; i < entry.debits.length; i++) {
    const d = entry.debits[i];
    rows.push(
      <tr key={`dr-${i}`} className={i === 0 ? "border-t" : ""}>
        {i === 0 && (
          <td
            className="py-1 pr-4 text-muted-foreground align-top"
            rowSpan={entry.debits.length + entry.credits.length}
          >
            <div className="font-medium text-foreground">
              {entry.sourceRecordName}
            </div>
            <div className="text-xs">{entry.description}</div>
          </td>
        )}
        <td className="py-1 pl-2">{d.account}</td>
        <td className="py-1 text-right tabular-nums">
          {formatCurrency(d.amount)}
        </td>
        <td className="py-1 text-right tabular-nums"></td>
      </tr>
    );
  }

  // Credit lines (indented)
  for (let i = 0; i < entry.credits.length; i++) {
    const c = entry.credits[i];
    rows.push(
      <tr key={`cr-${i}`}>
        <td className="py-1 pl-6 text-muted-foreground">{c.account}</td>
        <td className="py-1 text-right tabular-nums"></td>
        <td className="py-1 text-right tabular-nums">
          {formatCurrency(c.amount)}
        </td>
      </tr>
    );
  }

  return <>{rows}</>;
}

// ---------------------------------------------------------------------------
// Source Status Display Component
// ---------------------------------------------------------------------------

function SourceStatusDisplay({
  sourceModule,
  data,
}: {
  sourceModule: string;
  data: SourceStatusData;
}) {
  switch (sourceModule) {
    case "debt":
    case "assets": {
      const recons = data.reconciliations ?? [];
      if (recons.length === 0) {
        return (
          <p className="text-sm text-muted-foreground">
            No reconciliation data for this period
          </p>
        );
      }
      return (
        <div className="space-y-2">
          {recons.map(
            (
              r: {
                glAccountGroup: string;
                glBalance: number;
                subledgerBalance: number;
                variance: number;
                isReconciled: boolean;
              },
              i: number
            ) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="font-medium">{r.glAccountGroup}</span>
                <div className="flex items-center gap-3">
                  <span className="tabular-nums text-muted-foreground">
                    Var: {formatCurrency(r.variance ?? 0)}
                  </span>
                  {r.isReconciled ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                  ) : (
                    <AlertCircle className="h-4 w-4 text-red-500" />
                  )}
                </div>
              </div>
            )
          )}
          <Separator />
          <p
            className={`text-sm font-medium ${
              data.allReconciled ? "text-green-600" : "text-red-600"
            }`}
          >
            {data.allReconciled
              ? "All groups reconciled"
              : "Unreconciled groups remain"}
          </p>
        </div>
      );
    }

    case "leases": {
      const lease = data.lease;
      if (!lease) {
        return (
          <p className="text-sm text-muted-foreground">Lease not found</p>
        );
      }
      return (
        <div className="space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Lease</span>
            <span className="font-medium">{lease.leaseName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Type</span>
            <span className="capitalize">{lease.leaseType}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Status</span>
            <Badge variant="outline" className="text-xs capitalize">
              {lease.status}
            </Badge>
          </div>
        </div>
      );
    }

    case "tb": {
      return (
        <div className="space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Total Debits</span>
            <span className="tabular-nums">
              {formatCurrency(data.totalDebits ?? 0)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Total Credits</span>
            <span className="tabular-nums">
              {formatCurrency(data.totalCredits ?? 0)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Variance</span>
            <span
              className={`tabular-nums font-medium ${
                data.isBalanced ? "text-green-600" : "text-red-600"
              }`}
            >
              {formatCurrency(data.variance ?? 0)}
            </span>
          </div>
          {data.unmatchedCount > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Unmatched Accounts</span>
              <span className="text-red-600 font-medium">
                {data.unmatchedCount}
              </span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-muted-foreground">Account Count</span>
            <span>{data.accountCount ?? 0}</span>
          </div>
        </div>
      );
    }

    case "financial_statements": {
      return (
        <div className="space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Total Assets</span>
            <span className="tabular-nums">
              {formatCurrency(data.totalAssets ?? 0)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Total Liabilities</span>
            <span className="tabular-nums">
              {formatCurrency(data.totalLiabilities ?? 0)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Total Equity</span>
            <span className="tabular-nums">
              {formatCurrency(data.totalEquity ?? 0)}
            </span>
          </div>
          <Separator />
          <div className="flex justify-between">
            <span className="text-muted-foreground">A = L + E</span>
            <span
              className={`font-medium ${
                data.isBalanced ? "text-green-600" : "text-red-600"
              }`}
            >
              {data.isBalanced ? "Balanced" : `Off by ${formatCurrency(data.bsDifference ?? 0)}`}
            </span>
          </div>
        </div>
      );
    }

    case "intercompany": {
      if (data.status === "skipped" || data.status === "no_ic_accounts") {
        return (
          <p className="text-sm text-muted-foreground">
            {data.status === "skipped"
              ? "Single entity — no intercompany balances"
              : "No intercompany accounts found"}
          </p>
        );
      }
      return (
        <div className="space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">IC Accounts</span>
            <span>{data.icAccountCount ?? 0}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Net Balance</span>
            <span
              className={`tabular-nums font-medium ${
                data.isNetZero ? "text-green-600" : "text-red-600"
              }`}
            >
              {formatCurrency(data.netBalance ?? 0)}
            </span>
          </div>
        </div>
      );
    }

    case "payroll":
      return (
        <p className="text-sm text-muted-foreground">
          {data.message ?? "Manual verification required"}
        </p>
      );

    default:
      return (
        <p className="text-sm text-muted-foreground">
          No status display for this module
        </p>
      );
  }
}
