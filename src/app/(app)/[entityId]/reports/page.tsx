import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ArrowRight, BarChart3, FileText, Upload, TrendingUp } from "lucide-react";

export default async function ReportsPage({
  params,
}: {
  params: Promise<{ entityId: string }>;
}) {
  const { entityId } = await params;

  const reportSections = [
    {
      title: "Financial Statements",
      description: "Auto-generated P&L, Balance Sheet, and Cash Flow from QuickBooks data",
      icon: FileText,
      href: `/${entityId}/reports/financial-statements`,
    },
    {
      title: "Flux Analysis",
      description: "Period-over-period variance analysis with materiality thresholds",
      icon: TrendingUp,
      href: `/${entityId}/reports/flux-analysis`,
    },
    {
      title: "KPI Dashboard",
      description: "Custom KPIs with targets, trends, and configurable metrics",
      icon: BarChart3,
      href: `/${entityId}/reports/kpis`,
    },
    {
      title: "Uploaded Reports",
      description: "Upload and organize external reports by period and category",
      icon: Upload,
      href: `/${entityId}/reports/uploaded`,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Reports & KPIs
        </h1>
        <p className="text-muted-foreground">
          Financial reports, analytics, and key performance indicators
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {reportSections.map((section) => (
          <Link key={section.title} href={section.href}>
            <Card className="hover:border-primary/50 transition-colors cursor-pointer h-full">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <section.icon className="h-8 w-8 text-muted-foreground" />
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </div>
                <CardTitle className="text-lg">{section.title}</CardTitle>
                <CardDescription>{section.description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
