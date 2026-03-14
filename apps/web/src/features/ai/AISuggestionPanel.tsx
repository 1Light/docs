// apps/web/src/features/ai/AISuggestionPanel.tsx

import { useEffect, useMemo, useRef, useState } from "react";
import {
  applyAIJob,
  createAIJob,
  getAIJob,
  type AIOperation,
  type AIJob,
} from "../../features/ai/api";

import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Input } from "../../components/ui/Input";
import { Badge } from "../../components/ui/Badge";

type Props = {
  documentId: string;
  selection: { start: number; end: number; text: string };
  onApplied?: (result: { versionHeadId: string; updatedAt: string }) => void;
};

type Mode = "idle" | "running" | "ready" | "error";

const DEFAULT_OPS: Array<{ op: AIOperation; label: string; hint: string }> = [
  { op: "rewrite", label: "Rewrite", hint: "Improve clarity and tone." },
  { op: "summarize", label: "Summarize", hint: "Extract key points." },
  { op: "translate", label: "Translate", hint: "Convert into another language." },
  { op: "reformat", label: "Reformat", hint: "Restructure into a new format." },
];

function clampPreview(text: string, max = 220) {
  const t = text ?? "";
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1))}…`;
}

export function AISuggestionPanel({ documentId, selection, onApplied }: Props) {
  const [operation, setOperation] = useState<AIOperation>("rewrite");
  const [tone, setTone] = useState("");
  const [language, setLanguage] = useState("");
  const [formatStyle, setFormatStyle] = useState("");

  const [job, setJob] = useState<AIJob | null>(null);
  const [mode, setMode] = useState<Mode>("idle");
  const [error, setError] = useState<string | null>(null);
  const [finalText, setFinalText] = useState("");

  // Prevent multiple overlapping pollers
  const pollTimerRef = useRef<number | null>(null);

  const selectionLen = useMemo(
    () => Math.max(0, (selection?.end ?? 0) - (selection?.start ?? 0)),
    [selection?.start, selection?.end]
  );
  const canRun = useMemo(
    () => (selection?.end ?? 0) > (selection?.start ?? 0),
    [selection?.start, selection?.end]
  );

  const selectionPreview = useMemo(() => {
    const t = selection?.text ?? "";
    return clampPreview(t.trim(), 240);
  }, [selection?.text]);

  const activeOp = useMemo(
    () => DEFAULT_OPS.find((o) => o.op === operation) ?? DEFAULT_OPS[0],
    [operation]
  );

  const isRunning = mode === "running";
  const canApply = mode === "ready" && Boolean(job) && finalText.trim().length > 0;

  function clearPollTimer() {
    if (pollTimerRef.current != null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }

  // If the user changes selection while a job/result is present, reset to avoid applying into the wrong range
  useEffect(() => {
    if (mode === "idle") return;
    // If there is no job yet (or user edits selection), safest is reset.
    // This prevents "Generate" for one selection but "Apply" into a different one.
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection.start, selection.end, selection.text]);

  // Polling when running (MVP) : only one interval per jobId
  useEffect(() => {
    if (!job) return;

    const shouldPoll = job.status === "queued" || job.status === "running";
    if (!shouldPoll) {
      clearPollTimer();
      return;
    }

    setMode("running");

    // If a poller already exists for this job, don't create another
    if (pollTimerRef.current != null) return;

    pollTimerRef.current = window.setInterval(async () => {
      try {
        const latest = await getAIJob(job.jobId);
        setJob(latest);

        if (latest.status === "succeeded") {
          setFinalText(latest.result ?? "");
          setMode("ready");
          clearPollTimer();
          return;
        }

        if (latest.status === "failed") {
          setError(latest.error?.message ?? "AI job failed");
          setMode("error");
          clearPollTimer();
          return;
        }
      } catch (e: any) {
        setError(e?.message ?? "Failed to poll AI job");
        setMode("error");
        clearPollTimer();
      }
    }, 900);

    return () => {
      // cleanup on job change/unmount
      clearPollTimer();
    };
    // Intentionally depend on jobId + status, not the full job object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.jobId, job?.status]);

  async function run() {
    if (!canRun || isRunning) return;

    clearPollTimer();
    setError(null);
    setMode("running");
    setJob(null);
    setFinalText("");

    try {
      const created = await createAIJob({
        documentId,
        operation,
        selection: { start: selection.start, end: selection.end },
        parameters: {
          ...(tone ? { tone } : {}),
          ...(language ? { language } : {}),
          ...(formatStyle ? { formatStyle } : {}),
        },
      });

      setJob(created);

      if (created.status === "succeeded") {
        setFinalText(created.result ?? "");
        setMode("ready");
      } else if (created.status === "failed") {
        setError(created.error?.message ?? "AI job failed");
        setMode("error");
      } else {
        setMode("running");
      }
    } catch (e: any) {
      setError(e?.message ?? "Failed to create AI job");
      setMode("error");
    }
  }

  async function apply() {
    if (!job || !canApply) return;

    setError(null);

    try {
      const out = await applyAIJob(job.jobId, finalText);
      onApplied?.(out);

      clearPollTimer();
      setJob(null);
      setMode("idle");
      setFinalText("");
    } catch (e: any) {
      setError(e?.message ?? "Failed to apply suggestion");
      setMode("error");
    }
  }

  function reset() {
    clearPollTimer();
    setError(null);
    setJob(null);
    setMode("idle");
    setFinalText("");
  }

  return (
    <Card className="w-full overflow-hidden">
      <div className="border-b border-gray-200 bg-white px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-gray-900">AI suggestions</div>
            <div className="mt-1 text-xs text-gray-600">{activeOp.hint}</div>
          </div>

          <div className="flex items-center gap-2">
            <Badge variant={canRun ? "success" : "neutral"}>
              {canRun ? `${selectionLen} chars` : "No selection"}
            </Badge>
            <Badge
              variant={
                mode === "running" ? "warning" : mode === "ready" ? "success" : "neutral"
              }
            >
              {mode === "running"
                ? "Running"
                : mode === "ready"
                ? "Ready"
                : mode === "error"
                ? "Error"
                : "Idle"}
            </Badge>
          </div>
        </div>
      </div>

      <div className="p-4">
        {/* Selection preview */}
        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-medium text-gray-900">Selection</div>
            {canRun ? (
              <div className="text-xs text-gray-600">
                Range: {selection.start} to {selection.end}
              </div>
            ) : (
              <div className="text-xs text-gray-600">Select text in the editor to begin</div>
            )}
          </div>

          <div className="mt-2 max-h-28 overflow-auto rounded-xl border border-gray-200 bg-white p-3">
            <div className="whitespace-pre-wrap break-words text-xs leading-relaxed text-gray-800">
              {canRun ? (selectionPreview || "Selection is empty.") : "No selection."}
            </div>
          </div>

          {canRun && (selection.text?.length ?? 0) > selectionPreview.length ? (
            <div className="mt-2 text-xs text-gray-500">Preview is truncated for readability.</div>
          ) : (
            <div className="mt-2 text-xs text-gray-500">
              Tip: shorter selections usually produce better results.
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-gray-700">Operation</label>
            <div className="mt-2">
              <select
                className={[
                  "w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 shadow-sm",
                  "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2",
                  "disabled:bg-gray-50 disabled:text-gray-500",
                ].join(" ")}
                value={operation}
                onChange={(e) => setOperation(e.target.value as AIOperation)}
                disabled={isRunning}
              >
                {DEFAULT_OPS.map((o) => (
                  <option key={o.op} value={o.op}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="mt-2 text-xs text-gray-500">{activeOp.hint}</div>
          </div>

          {operation === "rewrite" && (
            <div>
              <label className="block text-xs font-medium text-gray-700">Tone</label>
              <div className="mt-2">
                <Input
                  value={tone}
                  onChange={(e) => setTone(e.target.value)}
                  placeholder="Example: formal, friendly"
                  disabled={isRunning}
                />
              </div>
              <div className="mt-2 text-xs text-gray-500">Optional: leave blank for default.</div>
            </div>
          )}

          {operation === "translate" && (
            <div>
              <label className="block text-xs font-medium text-gray-700">Language</label>
              <div className="mt-2">
                <Input
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  placeholder="Example: Arabic"
                  disabled={isRunning}
                />
              </div>
              <div className="mt-2 text-xs text-gray-500">Example: Arabic, French, Japanese.</div>
            </div>
          )}

          {operation === "reformat" && (
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-700">Format style</label>
              <div className="mt-2">
                <Input
                  value={formatStyle}
                  onChange={(e) => setFormatStyle(e.target.value)}
                  placeholder="Example: bullet points, meeting notes"
                  disabled={isRunning}
                />
              </div>
              <div className="mt-2 text-xs text-gray-500">
                Describe the target structure clearly.
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              onClick={run}
              disabled={!canRun || isRunning}
              className="w-full sm:w-auto"
            >
              {isRunning ? "Generating..." : "Generate"}
            </Button>

            <Button
              variant="secondary"
              onClick={apply}
              disabled={!canApply}
              className="w-full sm:w-auto"
            >
              Apply
            </Button>
          </div>

          <div className="flex items-center justify-between gap-2 sm:justify-end">
            <div className="text-xs text-gray-600">
              {mode === "idle" && "Ready when you are."}
              {mode === "running" && "Working on it."}
              {mode === "ready" && "Review and edit before applying."}
              {mode === "error" && "Fix the issue and try again."}
            </div>

            {(mode === "ready" || mode === "error") && (
              <button
                type="button"
                onClick={reset}
                className="text-xs font-medium text-gray-700 hover:text-gray-900 transition-colors"
              >
                Reset
              </button>
            )}
          </div>
        </div>

        {/* Result */}
        <div className="mt-4">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-semibold text-gray-900">Result</div>
            {mode === "ready" ? (
              <Badge variant="success">Editable</Badge>
            ) : mode === "running" ? (
              <Badge variant="warning">Generating</Badge>
            ) : (
              <Badge variant="neutral">Idle</Badge>
            )}
          </div>

          <div className="mt-2">
            <textarea
              className={[
                "w-full min-h-[160px] rounded-2xl border border-gray-200 bg-white p-3 text-sm text-gray-900 shadow-sm",
                "placeholder:text-gray-400",
                "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2",
                "disabled:bg-gray-50 disabled:text-gray-500",
              ].join(" ")}
              value={finalText}
              onChange={(e) => setFinalText(e.target.value)}
              placeholder={
                canRun
                  ? mode === "running"
                    ? "Generating suggestion..."
                    : "Your generated suggestion will appear here."
                  : "Select text in the editor to generate a suggestion."
              }
              disabled={mode === "running"}
            />
          </div>

          {mode === "error" && (
            <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <div className="font-medium text-red-900">Request failed</div>
              <div className="mt-1">{error ?? "Something went wrong"}</div>
            </div>
          )}

          {mode === "ready" && (
            <div className="mt-2 text-xs text-gray-500">
              You can edit the result directly. Apply will insert it into the selected range.
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}