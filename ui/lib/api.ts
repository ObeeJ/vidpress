export const API = process.env.NEXT_PUBLIC_API_URL ?? "https://api.theflate.com";

function headers(extra?: Record<string, string>): Record<string, string> {
  const key = typeof window !== "undefined"
    ? (window as Window & { __theflate_key?: string }).__theflate_key
    : undefined;
  return {
    ...(key ? { "x-api-key": key } : {}),
    ...extra,
  };
}

/** Every backend error handler returns `{"error": "<msg>"}` (src/handlers/*.rs
 *  - see analyze.rs::json_err, transcribe.rs, ingest.rs, jobs.rs, preview.rs,
 *  keys.rs), except the target_too_small refusal, which uses `.error` as a
 *  discriminator and carries the actual text in `.message` alongside it.
 *  Pulled out so uploadFile() (which needs the parsed object anyway, to also
 *  check for target_too_small) can reuse this without re-parsing the same
 *  JSON string a second time. */
function extractErrorMessage(parsed: unknown): string | null {
  const obj = parsed as { error?: unknown; message?: unknown } | null;
  if (typeof obj?.error === "string" && obj.error !== "target_too_small") return obj.error;
  if (typeof obj?.message === "string" && obj.message) return obj.message;
  return null;
}

/** Throwing `new Error(await r.text())` directly, as every function below
 *  used to, makes `Error.message` the literal JSON string - the UI has shown
 *  users things like `{"error":"unsupported file type"}` verbatim. This
 *  extracts the actual message, falling back to the raw body only if it is
 *  not the expected shape (e.g. a proxy's HTML error page) or genuinely has
 *  no message to extract. */
function parseApiError(raw: string): string {
  try {
    return extractErrorMessage(JSON.parse(raw)) ?? raw;
  } catch {
    return raw;
  }
}

export async function ingestFile(file: File, onProgress?: (pct: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API}/ingest`);
    xhr.setRequestHeader("x-file-name", file.name);
    const h = headers();
    Object.entries(h).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText).ingest_id);
      } else {
        reject(new Error(parseApiError(xhr.responseText)));
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
  if (!r.ok) throw new Error(parseApiError(await r.text()));
  return r.json();
}

/** One codec the chosen container can actually hold. Mirrors CodecChoice in
 *  src/media/codec_compat.rs - the server decides what is legal, because it is
 *  the side that has to make ffmpeg accept it. */
export type CodecOption = {
  id: string;
  video: string;
  audio: string;
  label: string;
  speed: "fast" | "balanced" | "slow";
};

/** The server's prediction of what a target size will look like, from
 *  src/media/quality.rs. `warning` is non-null only when quality will suffer. */
export type QualityInfo = {
  tier: "good" | "acceptable" | "poor" | "unusable";
  predicted_height: number;
  source_height: number;
  predicted_video_kbps: number;
  min_recommended_mb: number;
  warning: string | null;
};

export type UploadResult = {
  job_id: string;
  status: string;
  estimated_time_secs: number;
  codec_options: CodecOption[];
  quality?: QualityInfo;
};

/** Thrown when the server refuses a target size as unachievable. Carries the
 *  server's numbers so the UI can offer a workable size instead of a bare
 *  error string - the point of the pre-flight check is that the user decides
 *  with real figures in front of them. */
export class TargetTooSmallError extends Error {
  readonly minRecommendedMb: number;
  readonly predictedHeight: number;
  readonly predictedVideoKbps: number;
  readonly codecOptions: CodecOption[];

  constructor(d: {
    message: string;
    min_recommended_mb: number;
    predicted_height: number;
    predicted_video_kbps: number;
    codec_options?: CodecOption[];
  }) {
    super(d.message);
    this.name = "TargetTooSmallError";
    this.minRecommendedMb = d.min_recommended_mb;
    this.predictedHeight = d.predicted_height;
    this.predictedVideoKbps = d.predicted_video_kbps;
    this.codecOptions = d.codec_options ?? [];
  }
}

export async function uploadFile(
  ingestId: string,
  preset?: string,
  webhookUrl?: string,
  outputFormat?: string,
  targetMb?: number,
  codec?: string,
  force?: boolean,
): Promise<UploadResult> {
  const r = await fetch(`${API}/upload`, {
    method: "POST",
    headers: headers({ "content-type": "application/json" }),
    body: JSON.stringify({
      ingest_id: ingestId,
      preset,
      webhook_url: webhookUrl,
      output_format: outputFormat,
      target_mb: targetMb,
      codec,
      force,
    }),
  });

  if (!r.ok) {
    const raw = await r.text();
    // A 400 target_too_small is a structured refusal rather than a failure, so
    // it becomes a typed error the UI can act on. Anything that does not parse
    // falls through to the raw text - an unexpected error body must not be
    // swallowed into a misleading message.
    let typed: Error | null = null;
    try {
      const parsed = JSON.parse(raw) as { error?: unknown } | null;
      if (parsed?.error === "target_too_small") {
        typed = new TargetTooSmallError(parsed as ConstructorParameters<typeof TargetTooSmallError>[0]);
      } else {
        const msg = extractErrorMessage(parsed);
        if (msg) typed = new Error(msg);
      }
    } catch {
      // Not JSON; fall through to the raw body below.
    }
    throw typed ?? new Error(raw);
  }
  return r.json();
}

export function downloadFile(id: string, filename: string) {
  const key = typeof window !== "undefined"
    ? (window as Window & { __theflate_key?: string }).__theflate_key
    : undefined;
  const url = key
    ? `${API}/download/${id}?api_key=${encodeURIComponent(key)}`
    : `${API}/download/${id}`;
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export async function getJob(id: string) {
  const r = await fetch(`${API}/jobs/${id}`, { headers: headers() });
  if (!r.ok) throw new Error(parseApiError(await r.text()));
  return r.json();
}

export async function transcribeFile(jobId: string) {
  const r = await fetch(`${API}/transcribe`, {
    method: "POST",
    headers: headers({ "content-type": "application/json" }),
    body: JSON.stringify({ job_id: jobId }),
  });
  if (!r.ok) throw new Error(parseApiError(await r.text()));
  return r.json();
}

export async function getTranscription(id: string) {
  const r = await fetch(`${API}/transcriptions/${id}`, { headers: headers() });
  if (!r.ok) throw new Error(parseApiError(await r.text()));
  return r.json();
}

export async function exportToDestination(
  jobId: string,
  provider: string,
  options: {
    bucket?: string;
    endpoint?: string;
    region?: string;
    accessKey?: string;
    secretKey?: string;
    targetPath?: string;
  },
) {
  const r = await fetch(`${API}/export`, {
    method: "POST",
    headers: headers({ "content-type": "application/json" }),
    body: JSON.stringify({
      job_id: jobId,
      provider,
      // Must be a nested `destination` object — the server deserializes this
      // into a DestinationConfig. Flat bucket/endpoint keys at the top level
      // are ignored, which is why export previously always failed with
      // "no destination configured for this job". Credentials are used for
      // this single transfer and are never persisted server-side.
      destination: {
        provider,
        bucket: options.bucket,
        endpoint: options.endpoint,
        region: options.region,
        access_key: options.accessKey,
        secret_key: options.secretKey,
        target_path: options.targetPath,
      },
    }),
  });
  if (!r.ok) throw new Error(parseApiError(await r.text()));
  return r.json();
}
