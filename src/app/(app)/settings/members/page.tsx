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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";
import type { UserRole } from "@/lib/types/database";
import { getRoleLabel } from "@/lib/utils/permissions";

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

export default function MembersPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<UserRole>("preparer");
  const [inviting, setInviting] = useState(false);
  const supabase = createClient();

  const loadMembers = useCallback(async () => {
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
      .from("organization_members")
      .select("id, user_id, role, profiles(id, full_name, avatar_url)")
      .eq("organization_id", membership.organization_id)
      .order("created_at");

    setMembers((data as unknown as Member[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviting(true);

    toast.info(
      `Invite functionality requires email service integration. Share the signup link with ${inviteEmail} and add them after they create an account.`
    );

    setInviteEmail("");
    setInviting(false);
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Team Members</h1>
        <p className="text-muted-foreground">
          Manage your organization members and their roles
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Invite Member</CardTitle>
          <CardDescription>
            Add a new team member to your organization
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
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" disabled={inviting}>
                <UserPlus className="mr-2 h-4 w-4" />
                {inviting ? "Inviting..." : "Invite"}
              </Button>
            </div>
          </CardContent>
        </form>
      </Card>

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
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((member) => {
                  const initials =
                    member.profiles?.full_name
                      ?.split(" ")
                      .map((n) => n[0])
                      .join("")
                      .toUpperCase()
                      .slice(0, 2) ?? "??";

                  return (
                    <TableRow key={member.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            <AvatarFallback className="text-xs">
                              {initials}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-medium">
                            {member.profiles?.full_name ?? "Unknown"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={getRoleBadgeVariant(member.role)}>
                          {getRoleLabel(member.role)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
