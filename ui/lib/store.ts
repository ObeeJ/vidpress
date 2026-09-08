import { create } from "zustand";

export type JobStatus = "queued" | "processing" | "done" | "failed";

export interface Job {
  id: string;
  status: JobStatus;
  media_kind: string;
  input_path: string;
  output_path: string;
  original_bytes: number;
  compressed_bytes: number;
  duration_secs: number;
  progress: number;
  eta_secs: number;
}

export interface FileItem {
  file: File;
  localUrl: string;
  serverPath?: string;
  jobId?: string;
  job?: Job;
  profile?: MediaProfile;
  targetMb?: number;
  error?: string;
  uploadPct?: number;
  preset?: string;
  outputFormat?: string; // user-selected output format
}

export interface MediaProfile {
  kind: string;
  codec_name: string;
  duration_secs: number;
  size_bytes: number;
  width?: number;
  height?: number;
  estimated_output_mb: number;
  estimated_time_secs: number;
  output_ext: string;
  available_formats: string[];
}

interface Store {
  files: FileItem[];
  networkMbps: number;
  addFiles: (files: File[]) => void;
  setProfile: (localUrl: string, profile: MediaProfile) => void;
  setServerPath: (localUrl: string, serverPath: string) => void;
  setUploadPct: (localUrl: string, pct: number) => void;
  setJobId: (localUrl: string, jobId: string) => void;
  setJob: (localUrl: string, job: Job) => void;
  setTargetMb: (localUrl: string, mb: number) => void;
  setPreset: (localUrl: string, preset: string) => void;
  setOutputFormat: (localUrl: string, fmt: string) => void;
  setError: (localUrl: string, error: string) => void;
  setNetworkMbps: (mbps: number) => void;
  addFileWithUrl: (file: File, localUrl: string) => void;
  removeFile: (localUrl: string) => void;
}

export const useStore = create<Store>((set) => ({
  files: [],
  networkMbps: 50,
  addFiles: (incoming) =>
    set((s) => ({
      files: [
        ...s.files,
        ...incoming.map((f) => ({ file: f, localUrl: URL.createObjectURL(f) })),
      ],
    })),
  setProfile: (localUrl, profile) =>
    set((s) => ({
      files: s.files.map((f) => (f.localUrl === localUrl ? { ...f, profile, targetMb: profile.estimated_output_mb, outputFormat: profile.output_ext } : f)),
    })),
  setServerPath: (localUrl, serverPath) =>
    set((s) => ({
      files: s.files.map((f) => (f.localUrl === localUrl ? { ...f, serverPath } : f)),
    })),
  setUploadPct: (localUrl, uploadPct) =>
    set((s) => ({
      files: s.files.map((f) => (f.localUrl === localUrl ? { ...f, uploadPct } : f)),
    })),
  setJobId: (localUrl, jobId) =>
    set((s) => ({
      files: s.files.map((f) => (f.localUrl === localUrl ? { ...f, jobId } : f)),
    })),
  setJob: (localUrl, job) =>
    set((s) => ({
      files: s.files.map((f) => (f.localUrl === localUrl ? { ...f, job } : f)),
    })),
  setTargetMb: (localUrl, targetMb) =>
    set((s) => ({
      files: s.files.map((f) => (f.localUrl === localUrl ? { ...f, targetMb } : f)),
    })),
  setPreset: (localUrl, preset) =>
    set((s) => ({
      files: s.files.map((f) => (f.localUrl === localUrl ? { ...f, preset } : f)),
    })),
  setOutputFormat: (localUrl, outputFormat) =>
    set((s) => ({
      files: s.files.map((f) => (f.localUrl === localUrl ? { ...f, outputFormat } : f)),
    })),
  setError: (localUrl, error) =>
    set((s) => ({
      files: s.files.map((f) => (f.localUrl === localUrl ? { ...f, error } : f)),
    })),
  setNetworkMbps: (networkMbps) => set({ networkMbps }),
  addFileWithUrl: (file, localUrl) =>
    set((s) => ({
      files: [...s.files, { file, localUrl }],
    })),
  removeFile: (localUrl) =>
    set((s) => ({ files: s.files.filter((f) => f.localUrl !== localUrl) })),
}));
