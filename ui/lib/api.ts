const API = "http://localhost:8080";

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

export async function uploadFile(path: string, preset?: string, webhookUrl?: string, outputFormat?: string) {
  const r = await fetch(`${API}/upload`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path, preset, webhook_url: webhookUrl, output_format: outputFormat }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function getJob(id: string) {
  const r = await fetch(`${API}/jobs/${id}`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
