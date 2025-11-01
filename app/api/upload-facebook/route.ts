import type { NextRequest } from "next/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const pageId = String(form.get("pageId") || "");
    const accessToken = String(form.get("accessToken") || "");
    const description = String(form.get("description") || "");
    const file = form.get("file");

    if (!pageId || !accessToken || !file || !(file instanceof File)) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400 });
    }

    // Forward multipart to Facebook Graph API
    const upstream = new FormData();
    upstream.append("source", file, "video.mp4");
    if (description) upstream.append("description", description);
    upstream.append("access_token", accessToken);

    const graphUrl = `https://graph.facebook.com/v21.0/${encodeURIComponent(pageId)}/videos`;
    const res = await fetch(graphUrl, { method: "POST", body: upstream as any });
    const data = await res.json();
    if (!res.ok) {
      return new Response(JSON.stringify({ error: data?.error?.message || "Facebook upload failed" }), { status: 500 });
    }

    return new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "Server error" }), { status: 500 });
  }
}
