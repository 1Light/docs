import { useEffect } from "react";
import { useEditor, EditorContent, type Editor as TiptapEditor } from "@tiptap/react";

import "prosemirror-view/style/prosemirror.css";

import { canEdit, type DocumentRole } from "./editorUtils";

type Props = {
  loading: boolean;
  isConnected: boolean;
  docRole: DocumentRole | null;
  extensions: any[];
  onEditorReady: (ed: TiptapEditor | null) => void;
  onSelectionChange: (sel: { start: number; end: number; text: string }) => void;
};

export function CollabEditor(props: Props) {
  const editor = useEditor({
    extensions: props.extensions,
    content: "",
    autofocus: false,
    editorProps: {
      attributes: {
        class: [
          "prose prose-sm sm:prose-base prose-gray max-w-none",
          "text-gray-900",
          "focus:outline-none",
          "min-h-[58vh] lg:min-h-[72vh]",
          "px-6 py-8 sm:px-12 sm:py-10",
          "leading-relaxed",
          "ProseMirror",
          "cursor-text",
          "select-text",
        ].join(" "),
      },
    },
    onSelectionUpdate(ctx) {
      const { from, to } = ctx.editor.state.selection;
      const text = ctx.editor.state.doc.textBetween(from, to, "\n");
      props.onSelectionChange({ start: from, end: to, text });
    },
    onTransaction(ctx) {
      const { from, to } = ctx.editor.state.selection;
      const text = ctx.editor.state.doc.textBetween(from, to, "\n");
      props.onSelectionChange({ start: from, end: to, text });
    },
  });

  useEffect(() => {
    props.onEditorReady(editor ?? null);
    return () => props.onEditorReady(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(canEdit(props.docRole) && props.isConnected && !props.loading);
  }, [editor, props.docRole, props.isConnected, props.loading]);

  if (!editor) {
    return (
      <div className="px-12 py-10">
        <div className="h-4 w-40 rounded bg-gray-100" />
      </div>
    );
  }

  return <EditorContent editor={editor} />;
}