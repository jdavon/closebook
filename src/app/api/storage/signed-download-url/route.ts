import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/storage/signed-download-url
 * Generates a signed download URL for Supabase Storage (private buckets).
 *
 * JSON body: { bucket, path }
 * Returns: { signedUrl }
 */
export async function POST(request: NextRequest) {
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
      .createSignedUrl(path, 60 * 5); // 5 minute expiry

    if (error) {
      return NextResponse.json(
        { error: `Failed to create signed URL: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ signedUrl: data.signedUrl });
  } catch (err) {
    console.error("Signed download URL error:", err);
    return NextResponse.json(
      { error: "Failed to generate download URL" },
      { status: 500 }
    );
  }
}
