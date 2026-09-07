// Server-side of the backend API this UI talks to. Must be set in any
// deployment other than local dev — see .env.example.
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";
const API = API_BASE_URL;

/// Log the real error (path, backend message — may contain internal detail
/// like filesystem paths) for debugging, but never hand it to the caller:
/// callers render this straight into the UI, and the backend's error text
/// isn't guaranteed to be safe to show to an end user.
function apiError(context: string, detail: unknown): Error {
  console.error(`[api] ${context}:`, detail);
  return new Error(context);
}

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
        try {
          resolve(JSON.parse(xhr.responseText).path);
        } catch (e) {
          reject(apiError("Upload failed", e));
        }
      } else {
        reject(apiError("Upload failed", xhr.responseText));
      }
    };
    xhr.onerror = () => reject(apiError("Upload failed", "network error"));
    xhr.send(file);
  });
}

export async function analyzeFile(path: string) {
  const r = await fetch(`${API}/analyze`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path }),
  });
  if (!r.ok) throw apiError("Analysis failed", await r.text().catch(() => r.statusText));
  return r.json();
}

export async function uploadFile(path: string, preset?: string, webhookUrl?: string, outputFormat?: string) {
  const r = await fetch(`${API}/upload`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path, preset, webhook_url: webhookUrl, output_format: outputFormat }),
  });
  if (!r.ok) throw apiError("Compression failed to start", await r.text().catch(() => r.statusText));
  return r.json();
}

export async function getJob(id: string) {
  const r = await fetch(`${API}/jobs/${id}`);
  if (!r.ok) throw apiError("Could not fetch job status", await r.text().catch(() => r.statusText));
  return r.json();
}
