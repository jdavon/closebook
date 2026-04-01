"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { BookOpen, CheckCircle2, XCircle } from "lucide-react";

export default function InviteAcceptPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const supabase = createClient();
  const [status, setStatus] = useState<"loading" | "success" | "error" | "expired">("loading");
  const [orgName, setOrgName] = useState("");
  const [roleName, setRoleName] = useState("");

  useEffect(() => {
    async function acceptInvite() {
      // Look up the invite
      const { data: invite, error } = await supabase
        .from("organization_invites")
        .select("id, organization_id, role, status, expires_at, organizations(name)")
        .eq("token", token)
        .single();

      if (error || !invite) {
        setStatus("error");
        return;
      }

      const org = invite.organizations as unknown as { name: string } | null;
      setOrgName(org?.name ?? "the organization");
      setRoleName(invite.role);

      if (invite.status === "accepted") {
        setStatus("success");
        return;
      }

      if (invite.status !== "pending") {
        setStatus("expired");
        return;
      }

      const expiresAt = new Date(invite.expires_at);
      if (expiresAt < new Date()) {
        setStatus("expired");
        return;
      }

      // Mark invite as accepted
      const { error: updateError } = await supabase
        .from("organization_invites")
        .update({
          status: "accepted",
          accepted_at: new Date().toISOString(),
        })
        .eq("id", invite.id);

      if (updateError) {
        setStatus("error");
        return;
      }

      setStatus("success");
    }

    acceptInvite();
  }, [token, supabase]);

  if (status === "loading") {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Processing your invite...
        </CardContent>
      </Card>
    );
  }

  if (status === "error") {
    return (
      <Card>
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-lg bg-destructive/10">
            <XCircle className="h-6 w-6 text-destructive" />
          </div>
          <CardTitle>Invalid Invite</CardTitle>
          <CardDescription>
            This invite link is not valid. Please ask your administrator for a new one.
          </CardDescription>
        </CardHeader>
        <CardFooter className="justify-center">
          <Link href="/login">
            <Button variant="outline">Go to Sign In</Button>
          </Link>
        </CardFooter>
      </Card>
    );
  }

  if (status === "expired") {
    return (
      <Card>
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-lg bg-destructive/10">
            <XCircle className="h-6 w-6 text-destructive" />
          </div>
          <CardTitle>Invite Expired</CardTitle>
          <CardDescription>
            This invite has expired or been cancelled. Please ask your administrator for a new one.
          </CardDescription>
        </CardHeader>
        <CardFooter className="justify-center">
          <Link href="/login">
            <Button variant="outline">Go to Sign In</Button>
          </Link>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="text-center">
        <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-lg bg-primary">
          <BookOpen className="h-6 w-6 text-primary-foreground" />
        </div>
        <CardTitle className="text-2xl">Welcome to CloseBook</CardTitle>
        <CardDescription>
          You&apos;ve been added to <strong>{orgName}</strong> as a{" "}
          <strong>{roleName}</strong>.
        </CardDescription>
      </CardHeader>
      <CardContent className="text-center">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30 mb-3">
          <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
        </div>
        <p className="text-sm text-muted-foreground">
          Your account is ready. Sign in with the email and password your administrator provided.
        </p>
      </CardContent>
      <CardFooter className="justify-center">
        <Link href="/login">
          <Button>Sign In</Button>
        </Link>
      </CardFooter>
    </Card>
  );
}
