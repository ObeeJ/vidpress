export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

function headers(extra?: Record<string, string>): Record<string, string> {
  const key = typeof window !== "undefined"
    ? (window as Window & { __theflate_key?: string }).__theflate_key
    : undefined;
  return {
    ...(key ? { "x-api-key": key } : {}),
    ...extra,
  };
}

export async function ingestFile(file: File, onProgress?: (pct: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API}/ingest`);
    xhr.setRequestHeader("x-file-name", file.name);
    const key = typeof window !== "undefined"
      ? (window as Window & { __theflate_key?: string }).__theflate_key
      : undefined;
    if (key) xhr.setRequestHeader("x-api-key", key);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText).ingest_id);
      } else {
        reject(new Error(xhr.responseText));
      }
    };
    xhr.onerror = () => reject(new Error("Upload failed"));
    xhr.send(file);
  });
}

export async function analyzeFile(ingestId: string) {
  const r = await fetch(`${API}/analyze`, {
    method: "POST",
    headers: headers({ "content-type": "application/json" }),
    body: JSON.stringify({ ingest_id: ingestId }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function uploadFile(ingestId: string, preset?: string, webhookUrl?: string, outputFormat?: string, targetMb?: number) {
  const r = await fetch(`${API}/upload`, {
    method: "POST",
    headers: headers({ "content-type": "application/json" }),
    body: JSON.stringify({ ingest_id: ingestId, preset, webhook_url: webhookUrl, output_format: outputFormat, target_mb: targetMb }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export function downloadFile(id: string, filename: string) {
  // Stream directly via navigation — no 2GB blob buffer in a mobile tab,
  // no revoke race. The server sets content-disposition: attachment. (M12)
  const a = document.createElement("a");
  a.href = `${API}/download/${id}`;
  a.download = filename;
  a.click();
}

export async function getJob(id: string) {
  const r = await fetch(`${API}/jobs/${id}`, { headers: headers() });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function transcribeFile(jobId: string) {
  const r = await fetch(`${API}/transcribe`, {
    method: "POST",
    headers: headers({ "content-type": "application/json" }),
    body: JSON.stringify({ job_id: jobId }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function exportToDestination(
  jobId: string,
  provider: string,
  options?: { bucket?: string; endpoint?: string; targetPath?: string }
) {
  const r = await fetch(`${API}/export`, {
    method: "POST",
    headers: headers({ "content-type": "application/json" }),
    body: JSON.stringify({
      job_id: jobId,
      provider,
      bucket: options?.bucket,
      endpoint: options?.endpoint,
      target_path: options?.targetPath,
    }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
