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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { toast } from "sonner";
import { UserPlus, MoreHorizontal, Clock, X } from "lucide-react";
import type { UserRole } from "@/lib/types/database";
import { getRoleLabel } from "@/lib/utils/permissions";
import { EntityAccessSection } from "./entity-access";

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

interface Invite {
  id: string;
  email: string;
  role: string;
  status: string;
  expires_at: string;
  created_at: string;
  invited_by: string;
}

export default function MembersPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string>("");
  const [currentUserRole, setCurrentUserRole] = useState<UserRole>("preparer");
  const [orgId, setOrgId] = useState<string>("");

  // Invite form
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<UserRole>("preparer");
  const [inviting, setInviting] = useState(false);

  // Role change dialog
  const [roleDialogOpen, setRoleDialogOpen] = useState(false);
  const [roleTarget, setRoleTarget] = useState<Member | null>(null);
  const [newRole, setNewRole] = useState<UserRole>("preparer");
  const [changingRole, setChangingRole] = useState(false);

  // Remove dialog
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<Member | null>(null);
  const [removing, setRemoving] = useState(false);

  const supabase = createClient();

  const loadData = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    setCurrentUserId(user.id);

    const { data: membership } = await supabase
      .from("organization_members")
      .select("organization_id, role")
      .eq("user_id", user.id)
      .single();

    if (!membership) return;

    setCurrentUserRole(membership.role as UserRole);
    setOrgId(membership.organization_id);

    // Load members
    const { data: membersData } = await supabase
      .from("organization_members")
      .select("id, user_id, role, profiles(id, full_name, avatar_url)")
      .eq("organization_id", membership.organization_id)
      .order("created_at");

    setMembers((membersData as unknown as Member[]) ?? []);

    // Load pending invites
    const { data: invitesData } = await supabase
      .from("organization_invites")
      .select("*")
      .eq("organization_id", membership.organization_id)
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    setInvites((invitesData as Invite[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const isAdmin = currentUserRole === "admin";
  const adminCount = members.filter((m) => m.role === "admin").length;

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviting(true);

    try {
      const res = await fetch("/api/members/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Failed to send invite");
        return;
      }

      if (data.memberAdded) {
        toast.success(data.message || "User added to organization");
      } else {
        toast.success(`Invite sent to ${inviteEmail}`);
      }

      setInviteEmail("");
      loadData();
    } catch {
      toast.error("Failed to send invite");
    } finally {
      setInviting(false);
    }
  }

  async function handleCancelInvite(inviteId: string) {
    try {
      const res = await fetch(`/api/members/invite/${inviteId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "Failed to cancel invite");
        return;
      }

      toast.success("Invite cancelled");
      loadData();
    } catch {
      toast.error("Failed to cancel invite");
    }
  }

  async function handleRoleChange() {
    if (!roleTarget) return;
    setChangingRole(true);

    try {
      const res = await fetch("/api/members", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId: roleTarget.id, role: newRole }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Failed to change role");
        return;
      }

      toast.success("Role updated");
      setRoleDialogOpen(false);
      loadData();
    } catch {
      toast.error("Failed to change role");
    } finally {
      setChangingRole(false);
    }
  }

  async function handleRemoveMember() {
    if (!removeTarget) return;
    setRemoving(true);

    try {
      const res = await fetch("/api/members", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId: removeTarget.id }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Failed to remove member");
        return;
      }

      toast.success("Member removed");
      setRemoveDialogOpen(false);
      loadData();
    } catch {
      toast.error("Failed to remove member");
    } finally {
      setRemoving(false);
    }
  }

  function getRoleBadgeVariant(role: UserRole) {
    switch (role) {
      case "admin":
        return "default" as const;
      case "controller":
        return "secondary" as const;
      default:
        return "outline" as const;
    }
  }

  function getInitials(name: string | undefined) {
    return (
      name
        ?.split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2) ?? "??"
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Team Members</h1>
        <p className="text-muted-foreground">
          Manage your organization members and their roles
        </p>
      </div>

      {/* Invite Form */}
      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Invite Member</CardTitle>
            <CardDescription>
              Send an invite to add a new team member
            </CardDescription>
          </CardHeader>
          <form onSubmit={handleInvite}>
            <CardContent>
              <div className="flex gap-4 items-end">
                <div className="flex-1 space-y-2">
                  <Label htmlFor="inviteEmail">Email Address</Label>
                  <Input
                    id="inviteEmail"
                    type="email"
                    placeholder="colleague@company.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="w-40 space-y-2">
                  <Label htmlFor="inviteRole">Role</Label>
                  <Select
                    value={inviteRole}
                    onValueChange={(v) => setInviteRole(v as UserRole)}
                  >
                    <SelectTrigger id="inviteRole">
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
                <Button type="submit" disabled={inviting}>
                  <UserPlus className="mr-2 h-4 w-4" />
                  {inviting ? "Sending..." : "Invite"}
                </Button>
              </div>
            </CardContent>
          </form>
        </Card>
      )}

      {/* Pending Invites */}
      {isAdmin && invites.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Pending Invites
            </CardTitle>
            <CardDescription>
              {invites.length} pending invite{invites.length !== 1 ? "s" : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="w-[80px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {invites.map((invite) => {
                  const expiresAt = new Date(invite.expires_at);
                  const now = new Date();
                  const daysLeft = Math.ceil(
                    (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
                  );

                  return (
                    <TableRow key={invite.id}>
                      <TableCell className="font-medium">
                        {invite.email}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {getRoleLabel(invite.role as UserRole)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {daysLeft > 0
                          ? `${daysLeft} day${daysLeft !== 1 ? "s" : ""}`
                          : "Expired"}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleCancelInvite(invite.id)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Current Members */}
      <Card>
        <CardHeader>
          <CardTitle>Current Members</CardTitle>
          <CardDescription>
            {members.length} member{members.length !== 1 ? "s" : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground text-sm">Loading...</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Role</TableHead>
                  {isAdmin && <TableHead className="w-[80px]">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((member) => {
                  const isCurrentUser = member.user_id === currentUserId;
                  const isLastAdmin =
                    member.role === "admin" && adminCount <= 1;

                  return (
                    <TableRow key={member.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            <AvatarFallback className="text-xs">
                              {getInitials(member.profiles?.full_name)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-medium">
                            {member.profiles?.full_name ?? "Unknown"}
                            {isCurrentUser && (
                              <span className="text-muted-foreground ml-1">
                                (You)
                              </span>
                            )}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={getRoleBadgeVariant(member.role)}>
                          {getRoleLabel(member.role)}
                        </Badge>
                      </TableCell>
                      {isAdmin && (
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                disabled={isCurrentUser && isLastAdmin}
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() => {
                                  setRoleTarget(member);
                                  setNewRole(member.role);
                                  setRoleDialogOpen(true);
                                }}
                              >
                                Change Role
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive"
                                disabled={isLastAdmin}
                                onClick={() => {
                                  setRemoveTarget(member);
                                  setRemoveDialogOpen(true);
                                }}
                              >
                                Remove Member
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Entity Access Overrides */}
      {(currentUserRole === "admin" || currentUserRole === "controller") && orgId && (
        <EntityAccessSection
          orgId={orgId}
          members={members}
        />
      )}

      {/* Role Change Dialog */}
      <Dialog open={roleDialogOpen} onOpenChange={setRoleDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Role</DialogTitle>
            <DialogDescription>
              Update the role for{" "}
              {roleTarget?.profiles?.full_name ?? "this member"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>New Role</Label>
              <Select
                value={newRole}
                onValueChange={(v) => setNewRole(v as UserRole)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="controller">Controller</SelectItem>
                  <SelectItem value="reviewer">Reviewer</SelectItem>
                  <SelectItem value="preparer">Preparer</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRoleDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleRoleChange} disabled={changingRole}>
              {changingRole ? "Updating..." : "Update Role"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove Member Alert Dialog */}
      <AlertDialog open={removeDialogOpen} onOpenChange={setRemoveDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Member</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove{" "}
              <strong>
                {removeTarget?.profiles?.full_name ?? "this member"}
              </strong>{" "}
              from the organization? They will lose access to all entities and
              data. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemoveMember}
              disabled={removing}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {removing ? "Removing..." : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
