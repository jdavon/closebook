"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
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
  ArrowLeft,
  Upload,
  FileText,
  Send,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils/dates";
import type { TaskStatus } from "@/lib/types/database";

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
  accounts?: { name: string; account_number: string | null } | null;
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

  const loadTask = useCallback(async () => {
    const [taskResult, commentsResult, attachmentsResult] = await Promise.all([
      supabase
        .from("close_tasks")
        .select("*, accounts(name, account_number)")
        .eq("id", taskId)
        .single(),
      supabase
        .from("close_task_comments")
        .select("*, profiles(full_name)")
        .eq("close_task_id", taskId)
        .order("created_at"),
      supabase
        .from("close_task_attachments")
        .select("*")
        .eq("close_task_id", taskId)
        .order("created_at", { ascending: false }),
    ]);

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
    }

    setLoading(false);
  }, [supabase, taskId]);

  useEffect(() => {
    loadTask();
  }, [loadTask]);

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

  if (loading) return <p className="text-muted-foreground">Loading...</p>;
  if (!task) return <p className="text-muted-foreground">Task not found</p>;

  const varianceClass =
    task.variance === null
      ? ""
      : task.variance === 0
      ? "text-green-600"
      : "text-red-600";

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

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {task.name}
          </h1>
          {task.accounts && (
            <p className="text-muted-foreground">
              {task.accounts.account_number} - {task.accounts.name}
            </p>
          )}
          {task.category && (
            <Badge variant="outline" className="mt-1">
              {task.category}
            </Badge>
          )}
        </div>
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
      </div>

      {task.description && (
        <p className="text-muted-foreground">{task.description}</p>
      )}

      <div className="grid gap-6 md:grid-cols-2">
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
              />
            </div>
            {task.variance !== null && (
              <div className="space-y-2">
                <Label>Variance</Label>
                <div className={`text-lg font-semibold tabular-nums ${varianceClass}`}>
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
              />
            </div>
            <Button onClick={handleSaveReconciliation} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </CardContent>
        </Card>

        {/* Attachments & Comments */}
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
    </div>
  );
}
