import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // sanitize — only allow uuid-shaped ids
  if (!/^[0-9a-f-]{36}$/.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  // Ask the backend for the job to get the output path
  const job = await fetch(`http://localhost:8080/jobs/${id}`)
    .then((r) => r.json())
    .catch(() => null);

  if (!job || job.status !== "done") {
    return NextResponse.json({ error: "not ready" }, { status: 404 });
  }

  const filePath = job.output_path as string;
  // safety: must be under /tmp
  if (!filePath.startsWith("/tmp/")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const bytes = await readFile(filePath).catch(() => null);
  if (!bytes) return NextResponse.json({ error: "file not found" }, { status: 404 });

  const ext = path.extname(filePath).slice(1) || "mp4";
  const filename = `compressed_${id.slice(0, 8)}.${ext}`;

  return new NextResponse(bytes, {
    headers: {
      "content-type": `video/${ext}`,
      "content-disposition": `attachment; filename="${filename}"`,
      "content-length": String(bytes.length),
    },
  });
}
