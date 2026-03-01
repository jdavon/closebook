import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/storage/signed-upload-url
 * Generates a signed upload URL for Supabase Storage using the admin client
 * (service role, bypasses RLS). The client then uploads directly to that URL,
 * avoiding both Vercel's payload limit and storage RLS restrictions.
 *
 * JSON body: { bucket, path }
 * Returns: { signedUrl, token, path }
 */
export async function POST(request: NextRequest) {
  // Verify user is authenticated
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { bucket, path } = body as { bucket: string; path: string };

  if (!bucket || !path) {
    return NextResponse.json(
      { error: "Missing required fields: bucket, path" },
      { status: 400 }
    );
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.storage
      .from(bucket)
      .createSignedUploadUrl(path);

    if (error) {
      return NextResponse.json(
        { error: `Failed to create signed URL: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      signedUrl: data.signedUrl,
      token: data.token,
      path: data.path,
    });
  } catch (err) {
    console.error("Signed upload URL error:", err);
    return NextResponse.json(
      { error: "Failed to generate upload URL" },
      { status: 500 }
    );
  }
}
