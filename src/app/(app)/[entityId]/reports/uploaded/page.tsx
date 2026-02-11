"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
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
import { toast } from "sonner";
import { Upload, FileText, Download } from "lucide-react";
import { getPeriodLabel, getCurrentPeriod } from "@/lib/utils/dates";

interface UploadedReport {
  id: string;
  name: string;
  description: string | null;
  file_name: string;
  file_path: string;
  file_size: number | null;
  category: string | null;
  period_year: number;
  period_month: number;
  created_at: string;
}

export default function UploadedReportsPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const supabase = createClient();

  const currentPeriod = getCurrentPeriod();
  const [reports, setReports] = useState<UploadedReport[]>([]);
  const [loading, setLoading] = useState(true);

  // Upload form state
  const [uploadName, setUploadName] = useState("");
  const [uploadCategory, setUploadCategory] = useState("");
  const [uploadYear, setUploadYear] = useState(String(currentPeriod.year));
  const [uploadMonth, setUploadMonth] = useState(String(currentPeriod.month));
  const [uploading, setUploading] = useState(false);

  const loadReports = useCallback(async () => {
    const { data } = await supabase
      .from("uploaded_reports")
      .select("*")
      .eq("entity_id", entityId)
      .order("period_year", { ascending: false })
      .order("period_month", { ascending: false })
      .order("created_at", { ascending: false });

    setReports((data as UploadedReport[]) ?? []);
    setLoading(false);
  }, [supabase, entityId]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    setUploading(true);

    for (const file of Array.from(files)) {
      const filePath = `${entityId}/reports/${uploadYear}/${uploadMonth}/${Date.now()}_${file.name}`;

      const { error: uploadError } = await supabase.storage
        .from("uploaded-reports")
        .upload(filePath, file);

      if (uploadError) {
        toast.error(`Failed to upload ${file.name}: ${uploadError.message}`);
        continue;
      }

      const { error: dbError } = await supabase
        .from("uploaded_reports")
        .insert({
          entity_id: entityId,
          period_year: parseInt(uploadYear),
          period_month: parseInt(uploadMonth),
          name: uploadName || file.name,
          file_name: file.name,
          file_path: filePath,
          file_size: file.size,
          mime_type: file.type,
          category: uploadCategory || null,
          uploaded_by: user.id,
        });

      if (dbError) {
        toast.error(`Failed to save ${file.name}: ${dbError.message}`);
      }
    }

    toast.success("Report(s) uploaded");
    setUploadName("");
    setUploading(false);
    loadReports();
    e.target.value = "";
  }

  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Uploaded Reports
        </h1>
        <p className="text-muted-foreground">
          Upload and organize external reports by period
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Upload Report</CardTitle>
          <CardDescription>
            Upload PDF or Excel files from external sources
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-4">
            <div className="space-y-2">
              <Label>Report Name</Label>
              <Input
                placeholder="e.g., Board Report"
                value={uploadName}
                onChange={(e) => setUploadName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={uploadCategory} onValueChange={setUploadCategory}>
                <SelectTrigger>
                  <SelectValue placeholder="Select..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="board">Board Report</SelectItem>
                  <SelectItem value="tax">Tax</SelectItem>
                  <SelectItem value="audit">Audit</SelectItem>
                  <SelectItem value="management">Management</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Period</Label>
              <div className="flex gap-2">
                <Select value={uploadMonth} onValueChange={setUploadMonth}>
                  <SelectTrigger className="w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {months.map((m, i) => (
                      <SelectItem key={i + 1} value={String(i + 1)}>
                        {m.slice(0, 3)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={uploadYear} onValueChange={setUploadYear}>
                  <SelectTrigger className="w-20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[2024, 2025, 2026, 2027].map((y) => (
                      <SelectItem key={y} value={String(y)}>
                        {y}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>File</Label>
              <div>
                <Label
                  htmlFor="reportUpload"
                  className="flex items-center justify-center gap-2 rounded-md border px-4 py-2 cursor-pointer hover:bg-accent transition-colors"
                >
                  <Upload className="h-4 w-4" />
                  {uploading ? "Uploading..." : "Choose File"}
                </Label>
                <input
                  id="reportUpload"
                  type="file"
                  className="hidden"
                  accept=".pdf,.xlsx,.xls,.csv"
                  onChange={handleUpload}
                  disabled={uploading}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reports</CardTitle>
          <CardDescription>
            {reports.length} report{reports.length !== 1 ? "s" : ""} uploaded
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : reports.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No reports uploaded yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>File</TableHead>
                  <TableHead>Uploaded</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reports.map((report) => (
                  <TableRow key={report.id}>
                    <TableCell className="font-medium">
                      {report.name}
                    </TableCell>
                    <TableCell>
                      {getPeriodLabel(
                        report.period_year,
                        report.period_month
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground capitalize">
                      {report.category ?? "---"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm truncate max-w-32">
                          {report.file_name}
                        </span>
                        {report.file_size && (
                          <span className="text-xs text-muted-foreground">
                            ({(report.file_size / 1024).toFixed(0)} KB)
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(report.created_at).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
