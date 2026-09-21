import { getActiveAdmin, VERIFICATION_ID_PATTERN } from "../../admin-access";

export const dynamic = "force-dynamic";

const noStoreHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "Content-Security-Policy": "default-src 'none'; sandbox",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!VERIFICATION_ID_PATTERN.test(id)) {
    return new Response(null, { status: 404, headers: noStoreHeaders });
  }

  let auth: Awaited<ReturnType<typeof getActiveAdmin>>;

  try {
    auth = await getActiveAdmin();
  } catch {
    return new Response(null, { status: 503, headers: noStoreHeaders });
  }

  if (!auth) {
    return new Response(null, { status: 403, headers: noStoreHeaders });
  }

  let verification: { document_path: string } | null = null;

  try {
    const { data, error } = await auth.supabase
      .from("verifications")
      .select("document_path")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      return new Response(null, { status: 503, headers: noStoreHeaders });
    }

    verification = data;
  } catch {
    return new Response(null, { status: 503, headers: noStoreHeaders });
  }

  if (!verification?.document_path) {
    return new Response(null, { status: 404, headers: noStoreHeaders });
  }

  const extension = verification.document_path.split(".").at(-1)?.toLowerCase();
  const contentType =
    extension === "jpg" || extension === "jpeg"
      ? "image/jpeg"
      : extension === "png"
        ? "image/png"
        : extension === "webp"
          ? "image/webp"
          : null;

  if (!contentType) {
    return new Response(null, { status: 415, headers: noStoreHeaders });
  }

  try {
    const { data: image, error: downloadError } = await auth.supabase.storage
      .from("student-verifications")
      .download(verification.document_path);

    if (downloadError || !image) {
      return new Response(null, { status: 404, headers: noStoreHeaders });
    }

    return new Response(await image.arrayBuffer(), {
      status: 200,
      headers: {
        ...noStoreHeaders,
        "Content-Type": contentType,
        "Content-Disposition": 'inline; filename="school-id"',
      },
    });
  } catch {
    return new Response(null, { status: 503, headers: noStoreHeaders });
  }
}
