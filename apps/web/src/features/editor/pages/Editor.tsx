import { useEffect, useMemo, useRef, useState } from "react";
import type { Editor as TiptapEditor } from "@tiptap/react";

import { getDocument, updateDocument } from "../../documents/api";

import { PresenceLayer } from "../../presence/PresenceLayer";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { Badge } from "../../../components/ui/Badge";

import { EditorToolbar } from "../EditorToolbar";
import { EditorBubbleMenu } from "../EditorBubbleMenu";
import { CollabEditor } from "../CollabEditor";
import { EditorSidePanel } from "../EditorSidePanel";
import { useCollabEditorSession } from "../useCollabEditorSession";
import {
  canEdit,
  isYdocEmpty,
  readMe,
  scrollPosIntoView,
  useLatestRef,
  type DocumentRole,
  type SidePanel,
} from "../editorUtils";
import { useCommentSummary } from "../../comments/useCommentSummary";

type Props = {
  documentId: string;
  onBack?: () => void;
  onCurrentUserColorChange?: (color: string | null) => void;
};

export function EditorPage({ documentId, onBack, onCurrentUserColorChange }: Props) {
  const meRef = useRef(readMe());
  const me = meRef.current;

  const documentIdRef = useLatestRef(documentId);

  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(true);

  const isConnectedRef = useLatestRef(isConnected);
  const loadingRef = useLatestRef(loading);

  const [docTitle, setDocTitle] = useState<string>("Untitled document");
  const [docRole, setDocRole] = useState<DocumentRole | null>(null);
  const docRoleRef = useLatestRef(docRole);

  const [selection, setSelection] = useState<{ start: number; end: number; text: string }>({
    start: 0,
    end: 0,
    text: "",
  });
  const selectionRef = useLatestRef({ start: selection.start, end: selection.end });

  const [sidePanel, setSidePanel] = useState<SidePanel>("none");
  const [pendingCommentAnchor, setPendingCommentAnchor] = useState<{
    start: number;
    end: number;
    text: string;
  } | null>(null);

  const editorRef = useLatestRef<TiptapEditor | null>(null);
  const [editorInstance, setEditorInstance] = useState<TiptapEditor | null>(null);

  const {
    totalCommentsCount,
    openCommentsCount,
    openComments,
    applyOpenCommentHighlights,
    refreshCommentSummary,
    scheduleRefreshCommentSummary,
    clearScheduledCommentRefresh,
  } = useCommentSummary({
    documentId,
    editorRef,
    setSidePanel,
  });

  useEffect(() => {
    editorRef.current = editorInstance;
    if (editorInstance) {
      applyOpenCommentHighlights(editorInstance, openComments);
    }
  }, [editorInstance, openComments, applyOpenCommentHighlights, editorRef]);

  const savingRef = useRef(false);
  const lastSavedContentRef = useRef<string>("");
  const initialHtmlRef = useRef<string>("");
  const hydrateDoneRef = useRef(false);
  const suppressAutosaveRef = useRef(false);

  const seedT1Ref = useRef<number | null>(null);
  const seedT2Ref = useRef<number | null>(null);
  const ySaveTimerRef = useRef<number | null>(null);

  function clearSeedTimers() {
    if (seedT1Ref.current) window.clearTimeout(seedT1Ref.current);
    if (seedT2Ref.current) window.clearTimeout(seedT2Ref.current);
    seedT1Ref.current = null;
    seedT2Ref.current = null;
  }

  function clearYSaveTimer() {
    if (ySaveTimerRef.current) window.clearTimeout(ySaveTimerRef.current);
    ySaveTimerRef.current = null;
  }

  async function saveNow(content: string) {
    const role = docRoleRef.current;
    if (!canEdit(role)) return;
    if (!initialSyncDoneRef.current) return;

    if (savingRef.current) return;
    if (content === lastSavedContentRef.current) return;

    const id = documentIdRef.current;

    savingRef.current = true;
    try {
      await updateDocument(id, content);
      lastSavedContentRef.current = content;
    } catch (e: any) {
      setBanner(e?.message ?? "Failed to save document");
    } finally {
      savingRef.current = false;
    }
  }

  function applyServerContentWithoutAutosave(content: string) {
    const editor = editorRef.current;
    if (!editor) return;

    suppressAutosaveRef.current = true;
    hydrateDoneRef.current = false;

    initialHtmlRef.current = content;
    lastSavedContentRef.current = content;

    try {
      const cmdAny = editor.commands as any;
      if (typeof cmdAny.setContent === "function") {
        try {
          cmdAny.setContent(content, false);
        } catch {
          editor.commands.setContent(content);
        }
      }
    } finally {
      window.setTimeout(() => {
        hydrateDoneRef.current = true;
        suppressAutosaveRef.current = false;
      }, 0);
    }
  }

  const {
    presenceUsers,
    collabExtensions,
    managerRef,
    canSeedRef,
    initialSyncDoneRef,
  } = useCollabEditorSession({
    documentId,
    me,
    editorRef,
    selectionRef,
    isConnectedRef,
    loadingRef,
    setDocRole,
    setBanner,
    setIsConnected,
    scheduleRefreshCommentSummary,
  });

  useEffect(() => {
    const myLiveColor = presenceUsers.find((u) => u.userId === me.id)?.color?.trim() || null;
    onCurrentUserColorChange?.(myLiveColor);
  }, [presenceUsers, me.id, onCurrentUserColorChange]);

  useEffect(() => {
    return () => {
      onCurrentUserColorChange?.(null);
    };
  }, [onCurrentUserColorChange, documentId]);

  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);
      setBanner(null);

      initialHtmlRef.current = "";
      lastSavedContentRef.current = "";
      hydrateDoneRef.current = false;
      suppressAutosaveRef.current = false;

      try {
        const doc = await getDocument(documentId);
        if (!alive) return;

        const role = (doc as any)?.role as DocumentRole | undefined;
        setDocRole(role ?? null);

        const maybeTitle =
          (doc as any)?.title ?? (doc as any)?.name ?? (doc as any)?.documentTitle ?? null;

        setDocTitle(
          typeof maybeTitle === "string" && maybeTitle.trim().length > 0
            ? maybeTitle.trim()
            : "Untitled document"
        );

        const content = (doc as any)?.content || "";
        initialHtmlRef.current = content;
        lastSavedContentRef.current = content;

        await refreshCommentSummary({ maybeAutoOpen: true });
      } catch (e: any) {
        if (!alive) return;
        setBanner(e?.message ?? "Failed to load document");
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [documentId, refreshCommentSummary]);

  useEffect(() => {
    const mgr = managerRef.current;
    const editor = editorInstance;
    if (!mgr || !editor) return;

    editor.setEditable(canEdit(docRoleRef.current) && isConnected && !loading);

    clearSeedTimers();

    const html = (initialHtmlRef.current || "").trim();

    if (html.length > 0) {
      const trySeed = () => {
        try {
          if (!canSeedRef.current) return;
          if (!initialSyncDoneRef.current) return;

          const ydoc = mgr.ydoc as any;
          const meta = ydoc.getMap("__meta");

          if (meta.get("seeded") === true) return;

          if (!isYdocEmpty(ydoc)) {
            meta.set("seeded", true);
            return;
          }

          meta.set("seeded", true);

          mgr.ydoc.transact(() => {
            editor.commands.setContent(html);
          });
        } catch {
          // ignore
        }
      };

      seedT1Ref.current = window.setTimeout(trySeed, 50);
      seedT2Ref.current = window.setTimeout(trySeed, 250);
    }

    window.setTimeout(() => {
      hydrateDoneRef.current = true;
    }, 0);

    const onYDocUpdate = () => {
      if (suppressAutosaveRef.current) return;
      if (!hydrateDoneRef.current) return;
      if (!canEdit(docRoleRef.current)) return;
      if (!isConnected) return;
      if (!initialSyncDoneRef.current) return;

      clearYSaveTimer();
      ySaveTimerRef.current = window.setTimeout(() => {
        void saveNow(editor.getHTML());
      }, 900);
    };

    mgr.ydoc.on("update", onYDocUpdate);

    return () => {
      mgr.ydoc.off("update", onYDocUpdate);
      clearSeedTimers();
      clearYSaveTimer();
    };
  }, [editorInstance, isConnected, loading, managerRef, canSeedRef, initialSyncDoneRef, docRoleRef]);

  useEffect(() => {
    return () => {
      clearSeedTimers();
      clearYSaveTimer();
      clearScheduledCommentRefresh();

      const editor = editorInstance;
      if (!editor) return;
      if (!canEdit(docRoleRef.current)) return;
      if (!initialSyncDoneRef.current) return;
      if (suppressAutosaveRef.current) return;

      void saveNow(editor.getHTML());
    };
  }, [documentId, editorInstance, clearScheduledCommentRefresh, docRoleRef, initialSyncDoneRef]);

  function jumpToAnchor(anchor: { start: number; end: number }) {
    const editor = editorInstance;
    if (!editor) return;

    const from = Math.max(0, anchor.start);
    const to = Math.max(from, anchor.end);

    editor.commands.setTextSelection({ from, to });
    editor.commands.focus();

    scrollPosIntoView(editor, from);
  }

  const connectionBadge = (
    <Badge variant={isConnected ? "success" : "warning"}>
      {isConnected ? "Live" : "Reconnecting"}
    </Badge>
  );

  const showSidePanel = sidePanel !== "none";
  const bubbleDisabled = loading;

  const editorBody = useMemo(() => {
    if (!collabExtensions) {
      return (
        <div className="px-12 py-10">
          <div className="h-4 w-40 rounded bg-gray-100" />
        </div>
      );
    }

    return (
      <CollabEditor
        loading={loading}
        isConnected={isConnected}
        docRole={docRole}
        extensions={collabExtensions}
        onEditorReady={setEditorInstance}
        onSelectionChange={setSelection}
      />
    );
  }, [collabExtensions, loading, isConnected, docRole]);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="sticky top-0 z-20 border-b border-gray-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <Button variant="secondary" size="sm" onClick={onBack}>
              Back
            </Button>

            <div>
              <div className="flex items-center gap-2">
                <h1 className="truncate text-sm font-semibold text-gray-900 sm:text-base">
                  {docTitle}
                </h1>
                <span className="hidden sm:inline-flex">{connectionBadge}</span>
              </div>
              <div className="mt-0.5 text-xs text-gray-600">
                Signed in as {me.name}
                {docRole ? ` • Role: ${docRole}` : ""}
              </div>
            </div>
          </div>

          <PresenceLayer users={presenceUsers} />
        </div>

        <div className="border-t border-gray-200 bg-white">
          <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2 sm:px-6">
            <button
              type="button"
              onClick={() => {
                setSidePanel((cur) => (cur === "versions" ? "none" : "versions"));
                setPendingCommentAnchor(null);
              }}
              className={`rounded-xl px-3 py-2 text-xs font-medium transition-colors ${
                sidePanel === "versions"
                  ? "bg-gray-900 text-white"
                  : "text-gray-700 hover:bg-gray-100 hover:text-gray-900"
              }`}
              aria-pressed={sidePanel === "versions"}
              title="Open version history"
            >
              History
            </button>

            {totalCommentsCount > 0 && (
              <button
                type="button"
                onClick={() => {
                  setSidePanel((cur) => (cur === "comments" ? "none" : "comments"));
                  setPendingCommentAnchor(null);
                }}
                className={`rounded-xl px-3 py-2 text-xs font-medium transition-colors ${
                  sidePanel === "comments"
                    ? "bg-gray-900 text-white"
                    : "text-gray-700 hover:bg-gray-100 hover:text-gray-900"
                }`}
                aria-pressed={sidePanel === "comments"}
                title="Toggle comments panel"
              >
                Comments
                {openCommentsCount > 0 && (
                  <span className="ml-2 inline-flex items-center justify-center rounded-full bg-white/20 px-2 py-0.5 text-[10px]">
                    {openCommentsCount}
                  </span>
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-6">
        {banner && (
          <div className="mb-3 rounded-xl border border-yellow-200 bg-yellow-50 px-3 py-2 text-sm text-yellow-900">
            {banner}
          </div>
        )}

        <div className={`grid gap-4 ${showSidePanel ? "lg:grid-cols-12 lg:gap-6" : ""}`}>
          <div className={showSidePanel ? "lg:col-span-8" : ""}>
            <Card className="overflow-hidden">
              <div className="border-b border-gray-200 bg-white px-3 py-2 sm:px-6">
                <EditorToolbar
                  editor={editorInstance}
                  documentId={documentId}
                  disabled={loading || !isConnected || !editorInstance}
                  role={docRole}
                  meId={me.id}
                />
              </div>

              <div className="bg-gray-50">
                <div className="mx-auto max-w-[860px] py-7">
                  <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
                    <div className="relative">
                      <EditorBubbleMenu
                        editor={editorInstance}
                        disabled={bubbleDisabled || !editorInstance}
                        role={docRole}
                        onComment={() => {
                          const trimmed = selection.text.trim();
                          if (!trimmed) return;

                          setSidePanel("comments");
                          setPendingCommentAnchor(selection);
                        }}
                        onAI={() => {
                          const trimmed = selection.text.trim();
                          if (!trimmed) return;

                          setSidePanel("ai");
                          setPendingCommentAnchor(null);
                        }}
                      />

                      {editorBody}
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          </div>

          {showSidePanel && (
            <div className="lg:col-span-4">
              <EditorSidePanel
                sidePanel={sidePanel}
                documentId={documentId}
                selection={selection}
                pendingCommentAnchor={pendingCommentAnchor}
                role={docRole}
                meId={me.id}
                onClose={() => {
                  setSidePanel("none");
                  setPendingCommentAnchor(null);
                }}
                onJumpToAnchor={jumpToAnchor}
                onCommentsChanged={async () => {
                  setPendingCommentAnchor(null);
                  await refreshCommentSummary();
                }}
                onVersionReverted={async () => {
                  const doc = await getDocument(documentId);

                  const nextTitle =
                    (doc as any)?.title ??
                    (doc as any)?.name ??
                    (doc as any)?.documentTitle ??
                    "Untitled document";

                  const nextContent = (doc as any)?.content ?? "";

                  setDocTitle(
                    typeof nextTitle === "string" && nextTitle.trim().length > 0
                      ? nextTitle.trim()
                      : "Untitled document"
                  );

                  applyServerContentWithoutAutosave(nextContent);

                  setSidePanel("none");
                  setBanner(null);
                }}
                onVersionDeleted={async () => {
                  setBanner(null);
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}