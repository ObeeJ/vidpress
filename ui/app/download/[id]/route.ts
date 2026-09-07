import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

// Output files must resolve under this root. Matches the backend's own
// ingest directory (always /tmp — see INGEST_DIR in src/main.rs) and covers
// its configurable output directory too, since VIDPRESS_STORAGE defaults to
// a subdirectory of /tmp. Using the *resolved* path (not a raw string
// prefix check) means "/tmp/../etc/passwd" — which naive
// filePath.startsWith("/tmp/") would wrongly accept — correctly resolves
// outside this root and gets rejected.
const STORAGE_ROOT = path.resolve(/* turbopackIgnore: true */ process.env.DOWNLOAD_STORAGE_ROOT || "/tmp");

const CONTENT_TYPES: Record<string, string> = {
  mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", mkv: "video/x-matroska",
  webm: "video/webm", avi: "video/x-msvideo", gif: "image/gif",
  mp3: "audio/mpeg", m4a: "audio/mp4", ogg: "audio/ogg", flac: "audio/flac", wav: "audio/wav",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // sanitize — only allow uuid-shaped ids
  if (!/^[0-9a-f-]{36}$/.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  // Forward the original client's address so the backend's per-IP rate
  // limiter keys on the real caller, not on this Next.js server's own IP
  // (which every browser request through this route would otherwise share).
  const forwardedFor = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? undefined;

  // Ask the backend for the job to get the output path
  const job = await fetch(`${API_URL}/jobs/${id}`, {
    headers: forwardedFor ? { "x-forwarded-for": forwardedFor } : undefined,
  })
    .then((r) => r.json())
    .catch((e) => { console.error("[download route] failed to fetch job:", e); return null; });

  if (!job || job.status !== "done") {
    return NextResponse.json({ error: "not ready" }, { status: 404 });
  }

  const filePath = job.output_path as string;
  const resolved = path.resolve(filePath);
  if (resolved !== STORAGE_ROOT && !resolved.startsWith(STORAGE_ROOT + path.sep)) {
    console.error("[download route] rejected out-of-root path:", filePath);
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const bytes = await readFile(resolved).catch(() => null);
  if (!bytes) return NextResponse.json({ error: "file not found" }, { status: 404 });

  const ext = path.extname(resolved).slice(1).toLowerCase() || "mp4";
  const filename = `compressed_${id.slice(0, 8)}.${ext}`;

  return new NextResponse(bytes, {
    headers: {
      "content-type": CONTENT_TYPES[ext] || "application/octet-stream",
      "content-disposition": `attachment; filename="${filename}"`,
      "content-length": String(bytes.length),
    },
  });
}
