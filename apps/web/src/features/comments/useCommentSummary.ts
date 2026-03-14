import { useCallback, useRef, useState } from "react";
import type { Editor as TiptapEditor } from "@tiptap/react";

import { listComments, type Comment } from "./api";
import type { SidePanel } from "../editor/editorUtils";

type Args = {
  documentId: string;
  editorRef: React.MutableRefObject<TiptapEditor | null>;
  setSidePanel: React.Dispatch<React.SetStateAction<SidePanel>>;
};

export function useCommentSummary({ documentId, editorRef, setSidePanel }: Args) {
  const [totalCommentsCount, setTotalCommentsCount] = useState<number>(0);
  const [openCommentsCount, setOpenCommentsCount] = useState<number>(0);
  const [openComments, setOpenComments] = useState<Comment[]>([]);

  const commentSummaryRefreshTimeoutRef = useRef<number | null>(null);
  const lastCommentSummaryRefreshAtRef = useRef<number>(0);

  const applyOpenCommentHighlights = useCallback(
    (ed: TiptapEditor | null, comments: Comment[]) => {
      if (!ed) return;

      const anchors = (Array.isArray(comments) ? comments : [])
        .filter(
          (c) =>
            c.status === "open" &&
            c.anchor &&
            typeof c.anchor.start === "number" &&
            typeof c.anchor.end === "number"
        )
        .map((c) => ({
          from: c.anchor!.start,
          to: c.anchor!.end,
          commentId: c.commentId,
        }))
        .filter((a) => a.to > a.from);

      const cmdAny = ed.commands as any;

      if (typeof cmdAny.setCommentHighlights !== "function") return;

      if (anchors.length === 0) {
        if (typeof cmdAny.clearCommentHighlights === "function") {
          cmdAny.clearCommentHighlights();
        }
        return;
      }

      cmdAny.setCommentHighlights(anchors);
    },
    []
  );

  const refreshCommentSummary = useCallback(
    async (opts?: { maybeAutoOpen?: boolean }) => {
      lastCommentSummaryRefreshAtRef.current = Date.now();

      try {
        const [all, open] = await Promise.all([
          listComments(documentId, "all"),
          listComments(documentId, "open"),
        ]);

        const totalCount = Array.isArray(all) ? all.length : 0;
        const openCount = Array.isArray(open) ? open.length : 0;

        setTotalCommentsCount(totalCount);
        setOpenCommentsCount(openCount);

        const openItems = Array.isArray(open) ? open : [];
        setOpenComments(openItems);

        applyOpenCommentHighlights(editorRef.current, openItems);

        if (totalCount === 0) {
          setSidePanel((cur) => (cur === "comments" ? "none" : cur));
        }

        if (opts?.maybeAutoOpen && totalCount > 0) {
          setSidePanel((cur) => (cur === "ai" || cur === "versions" ? cur : "comments"));
        }
      } catch {
        setTotalCommentsCount(0);
        setOpenCommentsCount(0);
        setOpenComments([]);

        const ed = editorRef.current;
        const cmdAny = ed?.commands as any;

        if (ed && typeof cmdAny?.clearCommentHighlights === "function") {
          cmdAny.clearCommentHighlights();
        }

        setSidePanel((cur) => (cur === "comments" ? "none" : cur));
      }
    },
    [applyOpenCommentHighlights, documentId, editorRef, setSidePanel]
  );

  const scheduleRefreshCommentSummary = useCallback(
    (opts?: { maybeAutoOpen?: boolean }) => {
      const now = Date.now();
      const elapsed = now - lastCommentSummaryRefreshAtRef.current;

      if (commentSummaryRefreshTimeoutRef.current !== null) {
        window.clearTimeout(commentSummaryRefreshTimeoutRef.current);
        commentSummaryRefreshTimeoutRef.current = null;
      }

      if (elapsed > 250) {
        void refreshCommentSummary(opts);
        return;
      }

      commentSummaryRefreshTimeoutRef.current = window.setTimeout(() => {
        commentSummaryRefreshTimeoutRef.current = null;
        void refreshCommentSummary(opts);
      }, 250);
    },
    [refreshCommentSummary]
  );

  const clearScheduledCommentRefresh = useCallback(() => {
    if (commentSummaryRefreshTimeoutRef.current !== null) {
      window.clearTimeout(commentSummaryRefreshTimeoutRef.current);
      commentSummaryRefreshTimeoutRef.current = null;
    }
  }, []);

  return {
    totalCommentsCount,
    openCommentsCount,
    openComments,
    applyOpenCommentHighlights,
    refreshCommentSummary,
    scheduleRefreshCommentSummary,
    clearScheduledCommentRefresh,
  };
}