"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, Trash2, Shield } from "lucide-react";
import type { UserRole } from "@/lib/types/database";
import { getRoleLabel } from "@/lib/utils/permissions";

interface EntityAccessOverride {
  id: string;
  entity_id: string;
  user_id: string;
  role: string;
  entities: { name: string } | null;
  profiles: { full_name: string } | null;
}

interface Member {
  id: string;
  user_id: string;
  role: UserRole;
  profiles: {
    id: string;
    full_name: string;
    avatar_url: string | null;
  } | null;
}

interface Entity {
  id: string;
  name: string;
}

export function EntityAccessSection({
  orgId,
  members,
}: {
  orgId: string;
  members: Member[];
}) {
  const [overrides, setOverrides] = useState<EntityAccessOverride[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);

  // New override form
  const [selectedMember, setSelectedMember] = useState("");
  const [selectedEntity, setSelectedEntity] = useState("");
  const [selectedRole, setSelectedRole] = useState<UserRole>("preparer");
  const [saving, setSaving] = useState(false);

  const supabase = createClient();

  const loadData = useCallback(async () => {
    // Load entities
    const { data: entitiesData } = await supabase
      .from("entities")
      .select("id, name")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .order("name");

    setEntities((entitiesData as Entity[]) ?? []);

    // Load overrides
    const res = await fetch("/api/members/entity-access");
    if (res.ok) {
      const data = await res.json();
      setOverrides(data);
    }

    setLoading(false);
  }, [supabase, orgId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleAddOverride() {
    if (!selectedMember || !selectedEntity || !selectedRole) return;
    setSaving(true);

    try {
      const res = await fetch("/api/members/entity-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityId: selectedEntity,
          userId: selectedMember,
          role: selectedRole,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "Failed to add override");
        return;
      }

      toast.success("Entity access override added");
      setDialogOpen(false);
      setSelectedMember("");
      setSelectedEntity("");
      setSelectedRole("preparer");
      loadData();
    } catch {
      toast.error("Failed to add override");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemoveOverride(entityId: string, userId: string) {
    try {
      const res = await fetch("/api/members/entity-access", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityId, userId }),
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "Failed to remove override");
        return;
      }

      toast.success("Override removed");
      loadData();
    } catch {
      toast.error("Failed to remove override");
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Entity Access Overrides
              </CardTitle>
              <CardDescription>
                Assign custom roles per entity. Without an override, members use
                their organization-level role.
              </CardDescription>
            </div>
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Override
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground text-sm">Loading...</p>
          ) : overrides.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No entity-level overrides configured. All members use their
              organization role.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Override Role</TableHead>
                  <TableHead className="w-[80px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {overrides.map((override) => (
                  <TableRow key={override.id}>
                    <TableCell className="font-medium">
                      {override.profiles?.full_name ?? "Unknown"}
                    </TableCell>
                    <TableCell>
                      {override.entities?.name ?? "Unknown"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {getRoleLabel(override.role as UserRole)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() =>
                          handleRemoveOverride(
                            override.entity_id,
                            override.user_id
                          )
                        }
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add Override Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Entity Access Override</DialogTitle>
            <DialogDescription>
              Assign a custom role for a specific member on a specific entity.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Member</Label>
              <Select value={selectedMember} onValueChange={setSelectedMember}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a member" />
                </SelectTrigger>
                <SelectContent>
                  {members.map((m) => (
                    <SelectItem key={m.user_id} value={m.user_id}>
                      {m.profiles?.full_name ?? "Unknown"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Entity</Label>
              <Select value={selectedEntity} onValueChange={setSelectedEntity}>
                <SelectTrigger>
                  <SelectValue placeholder="Select an entity" />
                </SelectTrigger>
                <SelectContent>
                  {entities.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select
                value={selectedRole}
                onValueChange={(v) => setSelectedRole(v as UserRole)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="controller">Controller</SelectItem>
                  <SelectItem value="reviewer">Reviewer</SelectItem>
                  <SelectItem value="preparer">Preparer</SelectItem>
                  <SelectItem value="viewer">Viewer</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleAddOverride}
              disabled={saving || !selectedMember || !selectedEntity}
            >
              {saving ? "Saving..." : "Add Override"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
