"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils/dates";
import {
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Link2,
  Unlink,
  BarChart3,
  Pencil,
  Wand2,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import type { AccountClassification } from "@/lib/types/database";

interface MasterAccount {
  id: string;
  organization_id: string;
  account_number: string;
  name: string;
  description: string | null;
  classification: string;
  account_type: string;
  account_sub_type: string | null;
  parent_account_id: string | null;
  is_active: boolean;
  display_order: number;
  normal_balance: string;
  created_at: string;
}

interface EntityAccount {
  id: string;
  entity_id: string;
  name: string;
  account_number: string | null;
  classification: string;
  account_type: string;
  current_balance: number;
}

interface Entity {
  id: string;
  name: string;
  code: string;
}

interface Mapping {
  id: string;
  master_account_id: string;
  entity_id: string;
  account_id: string;
  entities: Entity;
  accounts: EntityAccount;
}

interface AutoMapSuggestion {
  entityId: string;
  entityName: string;
  entityCode: string;
  accountId: string;
  accountNumber: string | null;
  accountName: string;
  accountClassification: string;
  accountBalance: number;
  masterAccountId: string;
  masterAccountNumber: string;
  masterAccountName: string;
  masterClassification: string;
  confidence: "high" | "medium" | "low";
  matchReason: string;
}

const CLASSIFICATION_COLORS: Record<AccountClassification, string> = {
  Asset: "bg-blue-100 text-blue-800",
  Liability: "bg-red-100 text-red-800",
  Equity: "bg-purple-100 text-purple-800",
  Revenue: "bg-green-100 text-green-800",
  Expense: "bg-orange-100 text-orange-800",
};

const CLASSIFICATIONS: AccountClassification[] = [
  "Asset",
  "Liability",
  "Equity",
  "Revenue",
  "Expense",
];

const ACCOUNT_TYPES: Record<AccountClassification, string[]> = {
  Asset: [
    "Bank",
    "Accounts Receivable",
    "Other Current Asset",
    "Fixed Asset",
    "Other Asset",
  ],
  Liability: [
    "Accounts Payable",
    "Credit Card",
    "Other Current Liability",
    "Long Term Liability",
  ],
  Equity: ["Equity"],
  Revenue: ["Income", "Other Income"],
  Expense: ["Expense", "Other Expense", "Cost of Goods Sold"],
};

const CONFIDENCE_COLORS = {
  high: "bg-green-100 text-green-800",
  medium: "bg-yellow-100 text-yellow-800",
  low: "bg-gray-100 text-gray-600",
};

export default function MasterGLPage() {
  const router = useRouter();
  const supabase = createClient();

  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [masterAccounts, setMasterAccounts] = useState<MasterAccount[]>([]);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [entityAccounts, setEntityAccounts] = useState<
    Record<string, EntityAccount[]>
  >({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState("all");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // Dialog state for adding/editing master accounts
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingAccount, setEditingAccount] = useState<MasterAccount | null>(
    null
  );
  const [formData, setFormData] = useState({
    accountNumber: "",
    name: "",
    description: "",
    classification: "Asset" as AccountClassification,
    accountType: "",
    accountSubType: "",
  });
  const [saving, setSaving] = useState(false);

  // Sheet state for mapping
  const [mappingAccount, setMappingAccount] = useState<MasterAccount | null>(
    null
  );
  const [mappingSheetOpen, setMappingSheetOpen] = useState(false);
  const [selectedEntityId, setSelectedEntityId] = useState<string>("");
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");

  // Auto-map state
  const [showAutoMapDialog, setShowAutoMapDialog] = useState(false);
  const [autoMapSuggestions, setAutoMapSuggestions] = useState<
    AutoMapSuggestion[]
  >([]);
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<string>>(
    new Set()
  );
  const [autoMapLoading, setAutoMapLoading] = useState(false);
  const [applyingAutoMap, setApplyingAutoMap] = useState(false);

  const loadOrganization = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data: membership } = await supabase
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", user.id)
      .single();

    if (membership) {
      setOrganizationId(membership.organization_id);
    }
  }, [supabase]);

  const loadMasterAccounts = useCallback(async () => {
    if (!organizationId) return;

    const response = await fetch("/api/master-accounts");
    const data = await response.json();
    if (data.accounts) {
      setMasterAccounts(data.accounts);
    }
  }, [organizationId]);

  const loadMappings = useCallback(async () => {
    if (!organizationId) return;

    const response = await fetch(
      `/api/master-accounts/mappings?organizationId=${organizationId}`
    );
    const data = await response.json();
    if (data.mappings) {
      setMappings(data.mappings);
    }
  }, [organizationId]);

  const loadEntities = useCallback(async () => {
    if (!organizationId) return;

    const { data } = await supabase
      .from("entities")
      .select("id, name, code")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .order("name");

    if (data) {
      setEntities(data);
      // Load all accounts in one query instead of sequential
      const entityIds = data.map((e) => e.id);
      if (entityIds.length > 0) {
        const { data: allAccounts } = await supabase
          .from("accounts")
          .select(
            "id, entity_id, name, account_number, classification, account_type, current_balance"
          )
          .in("entity_id", entityIds)
          .eq("is_active", true)
          .order("classification")
          .order("account_number")
          .order("name");

        const accountsByEntity: Record<string, EntityAccount[]> = {};
        for (const account of (allAccounts as EntityAccount[]) ?? []) {
          if (!accountsByEntity[account.entity_id]) {
            accountsByEntity[account.entity_id] = [];
          }
          accountsByEntity[account.entity_id].push(account);
        }
        setEntityAccounts(accountsByEntity);
      }
    }
  }, [supabase, organizationId]);

  useEffect(() => {
    loadOrganization();
  }, [loadOrganization]);

  useEffect(() => {
    if (organizationId) {
      Promise.all([loadMasterAccounts(), loadMappings(), loadEntities()]).then(
        () => setLoading(false)
      );
    }
  }, [organizationId, loadMasterAccounts, loadMappings, loadEntities]);

  // Mapping coverage metrics
  const coverageMetrics = useMemo(() => {
    const allEntityAccounts = Object.values(entityAccounts).flat();
    const totalEntityAccounts = allEntityAccounts.length;
    const mappedAccountIds = new Set(mappings.map((m) => m.account_id));
    const mappedCount = allEntityAccounts.filter((a) =>
      mappedAccountIds.has(a.id)
    ).length;
    const unmappedCount = totalEntityAccounts - mappedCount;

    const totalMappedBalance = allEntityAccounts
      .filter((a) => mappedAccountIds.has(a.id))
      .reduce((s, a) => s + Math.abs(a.current_balance), 0);
    const totalBalance = allEntityAccounts.reduce(
      (s, a) => s + Math.abs(a.current_balance),
      0
    );

    const perEntity = entities.map((e) => {
      const eAccounts = entityAccounts[e.id] ?? [];
      const eMapped = eAccounts.filter((a) => mappedAccountIds.has(a.id));
      return {
        ...e,
        total: eAccounts.length,
        mapped: eMapped.length,
        unmapped: eAccounts.length - eMapped.length,
        pct:
          eAccounts.length > 0
            ? Math.round((eMapped.length / eAccounts.length) * 100)
            : 0,
      };
    });

    return {
      totalEntityAccounts,
      mappedCount,
      unmappedCount,
      pctMapped:
        totalEntityAccounts > 0
          ? Math.round((mappedCount / totalEntityAccounts) * 100)
          : 0,
      totalMappedBalance,
      totalBalance,
      pctBalanceMapped:
        totalBalance > 0
          ? Math.round((totalMappedBalance / totalBalance) * 100)
          : 0,
      perEntity,
    };
  }, [entities, entityAccounts, mappings]);

  function resetForm() {
    setFormData({
      accountNumber: "",
      name: "",
      description: "",
      classification: "Asset",
      accountType: "",
      accountSubType: "",
    });
  }

  function openAddDialog() {
    resetForm();
    setEditingAccount(null);
    setShowAddDialog(true);
  }

  function openEditDialog(account: MasterAccount) {
    setEditingAccount(account);
    setFormData({
      accountNumber: account.account_number,
      name: account.name,
      description: account.description ?? "",
      classification: account.classification as AccountClassification,
      accountType: account.account_type,
      accountSubType: account.account_sub_type ?? "",
    });
    setShowAddDialog(true);
  }

  async function handleSaveAccount() {
    setSaving(true);

    if (!formData.accountNumber || !formData.name || !formData.accountType) {
      toast.error("Account number, name, and type are required");
      setSaving(false);
      return;
    }

    try {
      if (editingAccount) {
        const response = await fetch("/api/master-accounts", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: editingAccount.id,
            accountNumber: formData.accountNumber,
            name: formData.name,
            description: formData.description || null,
            classification: formData.classification,
            accountType: formData.accountType,
            accountSubType: formData.accountSubType || null,
          }),
        });

        const data = await response.json();
        if (!response.ok) {
          toast.error(data.error || "Failed to update account");
          setSaving(false);
          return;
        }
        toast.success("Master account updated");
      } else {
        const response = await fetch("/api/master-accounts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            organizationId,
            accountNumber: formData.accountNumber,
            name: formData.name,
            description: formData.description || null,
            classification: formData.classification,
            accountType: formData.accountType,
            accountSubType: formData.accountSubType || null,
          }),
        });

        const data = await response.json();
        if (!response.ok) {
          toast.error(data.error || "Failed to create account");
          setSaving(false);
          return;
        }
        toast.success("Master account created");
      }

      setShowAddDialog(false);
      resetForm();
      setEditingAccount(null);
      await loadMasterAccounts();
    } catch {
      toast.error("An error occurred");
    }
    setSaving(false);
  }

  async function handleDeleteAccount(account: MasterAccount) {
    if (
      !confirm(
        `Delete master account "${account.account_number} - ${account.name}"? This will also remove all entity mappings for this account.`
      )
    ) {
      return;
    }

    const response = await fetch("/api/master-accounts", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: account.id }),
    });

    if (!response.ok) {
      const data = await response.json();
      toast.error(data.error || "Failed to delete account");
      return;
    }

    toast.success("Master account deleted");
    await loadMasterAccounts();
    await loadMappings();
  }

  function openMappingSheet(account: MasterAccount) {
    setMappingAccount(account);
    setSelectedEntityId("");
    setSelectedAccountId("");
    setMappingSheetOpen(true);
  }

  async function handleAddMapping() {
    if (!mappingAccount || !selectedEntityId || !selectedAccountId) {
      toast.error("Please select an entity and account");
      return;
    }

    const response = await fetch("/api/master-accounts/mappings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        masterAccountId: mappingAccount.id,
        entityId: selectedEntityId,
        accountId: selectedAccountId,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      toast.error(data.error || "Failed to create mapping");
      return;
    }

    toast.success("Account mapped successfully");
    setSelectedEntityId("");
    setSelectedAccountId("");
    await loadMappings();
  }

  async function handleRemoveMapping(mappingId: string) {
    const response = await fetch("/api/master-accounts/mappings", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: mappingId }),
    });

    if (!response.ok) {
      const data = await response.json();
      toast.error(data.error || "Failed to remove mapping");
      return;
    }

    toast.success("Mapping removed");
    await loadMappings();
  }

  // Auto-map functions
  async function handleAutoMap() {
    setAutoMapLoading(true);
    setShowAutoMapDialog(true);
    setSelectedSuggestions(new Set());

    const response = await fetch("/api/master-accounts/auto-map", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId }),
    });

    const data = await response.json();
    if (data.suggestions) {
      setAutoMapSuggestions(data.suggestions);
      // Auto-select high confidence
      const highConf = new Set<string>(
        data.suggestions
          .filter((s: AutoMapSuggestion) => s.confidence === "high")
          .map((s: AutoMapSuggestion) => s.accountId)
      );
      setSelectedSuggestions(highConf);
    }
    setAutoMapLoading(false);
  }

  function toggleSuggestion(accountId: string) {
    setSelectedSuggestions((prev) => {
      const next = new Set(prev);
      if (next.has(accountId)) {
        next.delete(accountId);
      } else {
        next.add(accountId);
      }
      return next;
    });
  }

  function selectAllSuggestions() {
    setSelectedSuggestions(
      new Set(autoMapSuggestions.map((s) => s.accountId))
    );
  }

  function deselectAllSuggestions() {
    setSelectedSuggestions(new Set());
  }

  async function applyAutoMapSuggestions() {
    const selected = autoMapSuggestions.filter((s) =>
      selectedSuggestions.has(s.accountId)
    );
    if (selected.length === 0) {
      toast.error("No suggestions selected");
      return;
    }

    setApplyingAutoMap(true);

    const response = await fetch("/api/master-accounts/mappings/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mappings: selected.map((s) => ({
          masterAccountId: s.masterAccountId,
          entityId: s.entityId,
          accountId: s.accountId,
        })),
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      toast.error(data.error || "Failed to apply mappings");
      setApplyingAutoMap(false);
      return;
    }

    toast.success(`${data.count} mappings created`);
    setShowAutoMapDialog(false);
    setApplyingAutoMap(false);
    await loadMappings();
  }

  // Filter accounts
  const filtered = masterAccounts.filter((a) => {
    const matchesSearch =
      !search ||
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.account_number.includes(search);
    const matchesClass =
      classFilter === "all" || a.classification === classFilter;
    return matchesSearch && matchesClass;
  });

  const grouped = filtered.reduce<Record<string, MasterAccount[]>>(
    (acc, account) => {
      const key = account.classification;
      if (!acc[key]) acc[key] = [];
      acc[key].push(account);
      return acc;
    },
    {}
  );

  function getMappingsForAccount(masterAccountId: string) {
    return mappings.filter((m) => m.master_account_id === masterAccountId);
  }

  function toggleCollapse(classification: string) {
    setCollapsed((prev) => ({
      ...prev,
      [classification]: !prev[classification],
    }));
  }

  // Get entity accounts available for mapping (not already mapped), filtered by classification
  const mappedAccountIds = new Set(mappings.map((m) => m.account_id));
  function getAvailableAccounts(entityId: string) {
    const accounts = entityAccounts[entityId] ?? [];
    return accounts.filter((a) => {
      if (mappedAccountIds.has(a.id)) return false;
      // Filter by master account's classification if mapping sheet is open
      if (mappingAccount) {
        return a.classification === mappingAccount.classification;
      }
      return true;
    });
  }

  function getAvailableAccountsAllClassifications(entityId: string) {
    const accounts = entityAccounts[entityId] ?? [];
    return accounts.filter((a) => !mappedAccountIds.has(a.id));
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Master General Ledger
          </h1>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Master General Ledger
          </h1>
          <p className="text-muted-foreground">
            Define a consolidated chart of accounts and map entity accounts from
            QuickBooks
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => router.push("/settings/master-gl/consolidated")}
          >
            <BarChart3 className="mr-2 h-4 w-4" />
            Consolidated View
          </Button>
          <Button
            variant="outline"
            onClick={handleAutoMap}
            disabled={masterAccounts.length === 0}
          >
            <Wand2 className="mr-2 h-4 w-4" />
            Auto-Map
          </Button>
          <Button onClick={openAddDialog}>
            <Plus className="mr-2 h-4 w-4" />
            Add Account
          </Button>
        </div>
      </div>

      {/* Mapping Coverage Dashboard */}
      {entities.length > 0 && (
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Account Coverage
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold">
                {coverageMetrics.pctMapped}%
              </div>
              <Progress
                value={coverageMetrics.pctMapped}
                className="mt-2 h-2"
              />
              <p className="text-xs text-muted-foreground mt-1">
                {coverageMetrics.mappedCount} of{" "}
                {coverageMetrics.totalEntityAccounts} accounts mapped
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Balance Coverage
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold">
                {coverageMetrics.pctBalanceMapped}%
              </div>
              <Progress
                value={coverageMetrics.pctBalanceMapped}
                className="mt-2 h-2"
              />
              <p className="text-xs text-muted-foreground mt-1">
                {formatCurrency(coverageMetrics.totalMappedBalance)} of{" "}
                {formatCurrency(coverageMetrics.totalBalance)} (absolute)
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Entity Coverage
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1.5 mt-1">
                {coverageMetrics.perEntity.map((e) => (
                  <div key={e.id} className="flex items-center gap-2 text-sm">
                    <Badge variant="outline" className="text-xs w-12 justify-center">
                      {e.code}
                    </Badge>
                    <Progress value={e.pct} className="flex-1 h-1.5" />
                    <span className="text-xs text-muted-foreground w-20 text-right">
                      {e.mapped}/{e.total}
                      {e.unmapped > 0 && (
                        <span className="text-amber-600 ml-1">
                          ({e.unmapped})
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Main accounts table */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-4">
            <Input
              placeholder="Search master accounts..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs"
            />
            <Select value={classFilter} onValueChange={setClassFilter}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Classification" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Classifications</SelectItem>
                {CLASSIFICATIONS.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="ml-auto text-sm text-muted-foreground">
              {masterAccounts.length} master account
              {masterAccounts.length !== 1 ? "s" : ""} &middot;{" "}
              {mappings.length} mapping{mappings.length !== 1 ? "s" : ""} across{" "}
              {entities.length} entit{entities.length !== 1 ? "ies" : "y"}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {masterAccounts.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground mb-4">
                No master accounts defined yet. Create your consolidated chart
                of accounts to begin mapping entity accounts.
              </p>
              <Button onClick={openAddDialog}>
                <Plus className="mr-2 h-4 w-4" />
                Add First Account
              </Button>
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No accounts match your search.
            </p>
          ) : (
            <div className="space-y-2">
              {CLASSIFICATIONS.map((classification) => {
                const classAccounts = grouped[classification];
                if (!classAccounts || classAccounts.length === 0) return null;
                const isCollapsed = collapsed[classification];

                return (
                  <div key={classification}>
                    <button
                      onClick={() => toggleCollapse(classification)}
                      className="flex items-center gap-2 w-full py-2 px-1 hover:bg-muted/50 rounded-md transition-colors"
                    >
                      {isCollapsed ? (
                        <ChevronRight className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                      <Badge
                        variant="outline"
                        className={CLASSIFICATION_COLORS[classification]}
                      >
                        {classification}
                      </Badge>
                      <span className="text-sm text-muted-foreground">
                        {classAccounts.length} account
                        {classAccounts.length !== 1 ? "s" : ""}
                      </span>
                    </button>

                    {!isCollapsed && (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-24">Number</TableHead>
                            <TableHead>Account Name</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Mapped Entities</TableHead>
                            <TableHead className="w-32 text-right">
                              Actions
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {classAccounts.map((account) => {
                            const accountMappings = getMappingsForAccount(
                              account.id
                            );
                            return (
                              <TableRow key={account.id}>
                                <TableCell className="font-mono text-sm">
                                  {account.account_number}
                                </TableCell>
                                <TableCell>
                                  <div>
                                    <span className="font-medium">
                                      {account.name}
                                    </span>
                                    {account.description && (
                                      <span className="text-xs block text-muted-foreground">
                                        {account.description}
                                      </span>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell className="text-muted-foreground text-sm">
                                  {account.account_type}
                                  {account.account_sub_type && (
                                    <span className="text-xs block text-muted-foreground/60">
                                      {account.account_sub_type}
                                    </span>
                                  )}
                                </TableCell>
                                <TableCell>
                                  <div className="flex flex-wrap gap-1">
                                    {accountMappings.length === 0 ? (
                                      <span className="text-xs text-muted-foreground">
                                        No mappings
                                      </span>
                                    ) : (
                                      accountMappings.map((m) => (
                                        <Badge
                                          key={m.id}
                                          variant="secondary"
                                          className="text-xs"
                                        >
                                          {m.entities?.code ?? "???"}
                                        </Badge>
                                      ))
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <div className="flex items-center justify-end gap-1">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() =>
                                        openMappingSheet(account)
                                      }
                                      title="Map entity accounts"
                                    >
                                      <Link2 className="h-4 w-4" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() =>
                                        openEditDialog(account)
                                      }
                                      title="Edit account"
                                    >
                                      <Pencil className="h-4 w-4" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() =>
                                        handleDeleteAccount(account)
                                      }
                                      title="Delete account"
                                    >
                                      <Trash2 className="h-4 w-4 text-destructive" />
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add/Edit Master Account Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingAccount ? "Edit Master Account" : "Add Master Account"}
            </DialogTitle>
            <DialogDescription>
              {editingAccount
                ? "Update the master account details."
                : "Define a new account in your consolidated chart of accounts."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="grid gap-4 grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="accountNumber">Account Number</Label>
                <Input
                  id="accountNumber"
                  placeholder="e.g., 1000"
                  value={formData.accountNumber}
                  onChange={(e) =>
                    setFormData({ ...formData, accountNumber: e.target.value })
                  }
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="name">Account Name</Label>
                <Input
                  id="name"
                  placeholder="e.g., Cash and Equivalents"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description (optional)</Label>
              <Input
                id="description"
                placeholder="e.g., All operating cash accounts"
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
              />
            </div>

            <div className="grid gap-4 grid-cols-2">
              <div className="space-y-2">
                <Label>Classification</Label>
                <Select
                  value={formData.classification}
                  onValueChange={(v) =>
                    setFormData({
                      ...formData,
                      classification: v as AccountClassification,
                      accountType: "",
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CLASSIFICATIONS.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Account Type</Label>
                <Select
                  value={formData.accountType}
                  onValueChange={(v) =>
                    setFormData({ ...formData, accountType: v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select type..." />
                  </SelectTrigger>
                  <SelectContent>
                    {(ACCOUNT_TYPES[formData.classification] ?? []).map(
                      (type) => (
                        <SelectItem key={type} value={type}>
                          {type}
                        </SelectItem>
                      )
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowAddDialog(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleSaveAccount} disabled={saving}>
              {saving
                ? "Saving..."
                : editingAccount
                ? "Update Account"
                : "Create Account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mapping Side Sheet */}
      <Sheet open={mappingSheetOpen} onOpenChange={setMappingSheetOpen}>
        <SheetContent className="overflow-y-auto sm:max-w-lg">
          {mappingAccount && (
            <>
              <SheetHeader>
                <SheetTitle>Map Entity Accounts</SheetTitle>
                <SheetDescription>
                  <span className="flex items-center gap-2 mt-1">
                    <Badge
                      variant="outline"
                      className={
                        CLASSIFICATION_COLORS[
                          mappingAccount.classification as AccountClassification
                        ]
                      }
                    >
                      {mappingAccount.classification}
                    </Badge>
                    <span className="font-mono">
                      {mappingAccount.account_number}
                    </span>
                    <span>{mappingAccount.name}</span>
                  </span>
                </SheetDescription>
              </SheetHeader>

              <div className="mt-6 space-y-6">
                <div className="space-y-3">
                  <h3 className="font-medium text-sm">Current Mappings</h3>
                  {getMappingsForAccount(mappingAccount.id).length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No entity accounts mapped yet.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {getMappingsForAccount(mappingAccount.id).map((m) => (
                        <div
                          key={m.id}
                          className="flex items-center justify-between rounded-md border p-3"
                        >
                          <div>
                            <div className="font-medium text-sm">
                              {m.entities?.name ?? "Unknown Entity"}
                              <Badge
                                variant="secondary"
                                className="ml-2 text-xs"
                              >
                                {m.entities?.code ?? "???"}
                              </Badge>
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {m.accounts?.account_number
                                ? `#${m.accounts.account_number} - `
                                : ""}
                              {m.accounts?.name ?? "Unknown Account"}
                              <span className="ml-2">
                                (
                                {formatCurrency(
                                  m.accounts?.current_balance ?? 0
                                )}
                                )
                              </span>
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemoveMapping(m.id)}
                          >
                            <Unlink className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <Separator />

                <div className="space-y-3">
                  <h3 className="font-medium text-sm">Add Mapping</h3>

                  <div className="space-y-2">
                    <Label>Entity</Label>
                    <Select
                      value={selectedEntityId}
                      onValueChange={(v) => {
                        setSelectedEntityId(v);
                        setSelectedAccountId("");
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select entity..." />
                      </SelectTrigger>
                      <SelectContent>
                        {entities.map((e) => (
                          <SelectItem key={e.id} value={e.id}>
                            {e.name} ({e.code})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {selectedEntityId && (
                    <div className="space-y-2">
                      <Label>
                        Entity Account{" "}
                        <span className="text-xs text-muted-foreground">
                          (filtered to {mappingAccount.classification})
                        </span>
                      </Label>
                      <Select
                        value={selectedAccountId}
                        onValueChange={setSelectedAccountId}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select account..." />
                        </SelectTrigger>
                        <SelectContent>
                          {getAvailableAccounts(selectedEntityId).map((a) => (
                            <SelectItem key={a.id} value={a.id}>
                              {a.account_number
                                ? `${a.account_number} - `
                                : ""}
                              {a.name}
                            </SelectItem>
                          ))}
                          {getAvailableAccounts(selectedEntityId).length ===
                            0 &&
                            getAvailableAccountsAllClassifications(
                              selectedEntityId
                            ).length > 0 && (
                              <>
                                <SelectItem value="_divider" disabled>
                                  --- Other classifications ---
                                </SelectItem>
                                {getAvailableAccountsAllClassifications(
                                  selectedEntityId
                                )
                                  .filter(
                                    (a) =>
                                      a.classification !==
                                      mappingAccount.classification
                                  )
                                  .map((a) => (
                                    <SelectItem key={a.id} value={a.id}>
                                      {a.account_number
                                        ? `${a.account_number} - `
                                        : ""}
                                      {a.name} ({a.classification})
                                    </SelectItem>
                                  ))}
                              </>
                            )}
                        </SelectContent>
                      </Select>
                      {getAvailableAccountsAllClassifications(selectedEntityId)
                        .length === 0 && (
                        <p className="text-xs text-muted-foreground">
                          All accounts for this entity are already mapped.
                        </p>
                      )}
                    </div>
                  )}

                  <Button
                    onClick={handleAddMapping}
                    disabled={!selectedEntityId || !selectedAccountId}
                    className="w-full"
                  >
                    <Link2 className="mr-2 h-4 w-4" />
                    Map Account
                  </Button>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Auto-Map Suggestions Dialog */}
      <Dialog open={showAutoMapDialog} onOpenChange={setShowAutoMapDialog}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Auto-Map Suggestions</DialogTitle>
            <DialogDescription>
              Review and select suggested mappings based on account
              number/name matching. High confidence suggestions are
              pre-selected.
            </DialogDescription>
          </DialogHeader>

          {autoMapLoading ? (
            <p className="py-8 text-center text-muted-foreground">
              Analyzing account matches...
            </p>
          ) : autoMapSuggestions.length === 0 ? (
            <div className="py-8 text-center">
              <CheckCircle2 className="mx-auto h-8 w-8 text-green-500 mb-2" />
              <p className="text-muted-foreground">
                All entity accounts are already mapped, or no matching master
                accounts were found.
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-4 mb-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={selectAllSuggestions}
                >
                  Select All ({autoMapSuggestions.length})
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={deselectAllSuggestions}
                >
                  Deselect All
                </Button>
                <span className="ml-auto text-sm text-muted-foreground">
                  {selectedSuggestions.size} of {autoMapSuggestions.length}{" "}
                  selected
                </span>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10"></TableHead>
                    <TableHead>Entity Account</TableHead>
                    <TableHead>Master Account</TableHead>
                    <TableHead>Confidence</TableHead>
                    <TableHead>Match Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {autoMapSuggestions.map((s) => (
                    <TableRow key={s.accountId}>
                      <TableCell>
                        <Checkbox
                          checked={selectedSuggestions.has(s.accountId)}
                          onCheckedChange={() =>
                            toggleSuggestion(s.accountId)
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          <Badge
                            variant="outline"
                            className="text-xs mr-1"
                          >
                            {s.entityCode}
                          </Badge>
                          {s.accountNumber && (
                            <span className="font-mono text-xs mr-1">
                              {s.accountNumber}
                            </span>
                          )}
                          <span>{s.accountName}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          <span className="font-mono text-xs mr-1">
                            {s.masterAccountNumber}
                          </span>
                          <span>{s.masterAccountName}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={CONFIDENCE_COLORS[s.confidence]}
                        >
                          {s.confidence}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[200px]">
                        {s.matchReason}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowAutoMapDialog(false)}
            >
              Cancel
            </Button>
            {autoMapSuggestions.length > 0 && (
              <Button
                onClick={applyAutoMapSuggestions}
                disabled={selectedSuggestions.size === 0 || applyingAutoMap}
              >
                {applyingAutoMap
                  ? "Applying..."
                  : `Apply ${selectedSuggestions.size} Mapping${selectedSuggestions.size !== 1 ? "s" : ""}`}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
