export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export async function ingestFile(file: File, onProgress?: (pct: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API}/ingest`);
    xhr.setRequestHeader("x-file-name", file.name);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText).path);
      } else {
        reject(new Error(xhr.responseText));
      }
    };
    xhr.onerror = () => reject(new Error("Upload failed"));
    xhr.send(file);
  });
}

export async function analyzeFile(path: string) {
  const r = await fetch(`${API}/analyze`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function uploadFile(path: string, preset?: string, webhookUrl?: string, outputFormat?: string, targetMb?: number) {
  const r = await fetch(`${API}/upload`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path, preset, webhook_url: webhookUrl, output_format: outputFormat, target_mb: targetMb }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function downloadFile(id: string, filename: string) {
  const r = await fetch(`${API}/download/${id}`);
  if (!r.ok) throw new Error("Download failed");
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function getJob(id: string) {
  const r = await fetch(`${API}/jobs/${id}`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function transcribeFile(jobId: string) {
  const r = await fetch(`${API}/transcribe`, {
    method: "POST",
    headers: { "content-type": "application/json" },
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
    headers: { "content-type": "application/json" },
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
