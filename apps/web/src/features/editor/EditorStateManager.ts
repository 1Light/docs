// apps/web/src/editor/EditorStateManager.ts

import * as Y from "yjs";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from "y-protocols/awareness";
import type { Socket } from "socket.io-client";

import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";

import { tiptapExtensions, renderCollaborationCursor } from "./tiptapExtensions";

function u8ToArr(u8: Uint8Array): number[] {
  return Array.from(u8);
}

function arrToU8(arr: number[]): Uint8Array {
  return Uint8Array.from(arr);
}

function hashToHue(input: string) {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0;
  }
  return h % 360;
}

function normalizeHue(hue: number) {
  const buckets = [0, 28, 48, 88, 140, 176, 220, 262, 304, 336];
  let best = buckets[0];
  let bestDist = Infinity;

  for (const bucket of buckets) {
    const dist = Math.min(Math.abs(bucket - hue), 360 - Math.abs(bucket - hue));
    if (dist < bestDist) {
      best = bucket;
      bestDist = dist;
    }
  }

  return best;
}

export function stableUserColor(userId: string, name: string) {
  const base = `${userId}:${name}`.trim();
  const rawHue = hashToHue(base || "user");
  const hue = normalizeHue(rawHue);

  return `hsl(${hue} 78% 46%)`;
}

type UserCursorInfo = {
  id: string;
  name: string;
  color?: string;
};

type AwarenessUpdatePayload = {
  documentId: string;
  added: number[];
  updated: number[];
  removed: number[];
  states: number[];
};

type DocumentJoinedPayload = {
  documentId: string;
};

type AwarenessChange = {
  added: number[];
  updated: number[];
  removed: number[];
};

type AwarenessListener = (...args: any[]) => void;

class AwarenessProviderBridge {
  public awareness: Awareness;
  private listeners = new Map<string, Set<AwarenessListener>>();

  constructor(awareness: Awareness) {
    this.awareness = awareness;

    this.awareness.on("update", (event: AwarenessChange, origin: unknown) => {
      this.emit("awarenessUpdate", event, origin);
      this.emit("awarenessChange", event, origin);
      this.emit("update", event, origin);
    });
  }

  on(event: string, cb: AwarenessListener) {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(cb);
  }

  off(event: string, cb: AwarenessListener) {
    const set = this.listeners.get(event);
    if (!set) return;
    set.delete(cb);
    if (set.size === 0) {
      this.listeners.delete(event);
    }
  }

  emit(event: string, ...args: any[]) {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const cb of set) {
      cb(...args);
    }
  }
}

export class EditorStateManager {
  private socket: Socket;
  private user: UserCursorInfo;

  private documentId: string | null = null;

  public ydoc: Y.Doc;
  public awareness: Awareness;

  private providerBridge: AwarenessProviderBridge;

  private isBound = false;
  private destroyed = false;

  private isDocJoined = false;
  private pendingJoinDocId: string | null = null;

  private onSyncStep2?: (payload: { documentId: string; update: number[] }) => void;
  private onRemoteDocUpdate?: (payload: { documentId: string; update: number[] }) => void;

  private onDocUpdate?: (update: Uint8Array, origin: unknown) => void;

  private onAwarenessRemote?: (payload: AwarenessUpdatePayload) => void;
  private onAwarenessLocal?: (event: AwarenessChange, origin: unknown) => void;

  private onSocketConnect?: () => void;
  private onDocumentJoined?: (payload: DocumentJoinedPayload) => void;

  constructor(socket: Socket, user: UserCursorInfo) {
    this.socket = socket;

    const resolvedColor = user.color ?? stableUserColor(user.id, user.name);
    this.user = { ...user, color: resolvedColor };

    this.ydoc = new Y.Doc();
    this.awareness = new Awareness(this.ydoc);
    this.providerBridge = new AwarenessProviderBridge(this.awareness);

    this.setLocalAwarenessUser();
    this.bindDocHandlers();
  }

  private setLocalAwarenessUser() {
    this.awareness.setLocalStateField("user", {
      id: this.user.id,
      name: this.user.name,
      color: this.user.color,
    });
  }

  setUserColor(color?: string) {
    const nextColor = color?.trim() || stableUserColor(this.user.id, this.user.name);

    if (this.user.color === nextColor) return;

    this.user = {
      ...this.user,
      color: nextColor,
    };

    this.awareness.setLocalStateField("user", {
      id: this.user.id,
      name: this.user.name,
      color: this.user.color,
    });

    const clients = Array.from(this.awareness.getStates().keys());
    const update = encodeAwarenessUpdate(this.awareness, clients);

    if (this.documentId && this.socket.connected) {
      this.socket.emit("yjs:awareness_update", {
        documentId: this.documentId,
        added: [],
        updated: clients,
        removed: [],
        states: Array.from(update),
      } satisfies AwarenessUpdatePayload);
    }
  }

  private bindDocHandlers() {
    this.onDocUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === "remote") return;
      if (!this.documentId) return;
      if (!this.socket.connected) return;
      if (!this.isDocJoined) return;

      this.socket.emit("yjs:update", {
        documentId: this.documentId,
        update: u8ToArr(update),
      });
    };
    this.ydoc.on("update", this.onDocUpdate);

    this.onAwarenessLocal = (event: AwarenessChange, origin: unknown) => {
      if (origin === "remote") return;
      if (!this.documentId) return;
      if (!this.socket.connected) return;
      if (!this.isDocJoined) return;

      const { added, updated, removed } = event;
      const update = encodeAwarenessUpdate(this.awareness, [...added, ...updated, ...removed]);

      this.socket.emit("yjs:awareness_update", {
        documentId: this.documentId,
        added,
        updated,
        removed,
        states: u8ToArr(update),
      } satisfies AwarenessUpdatePayload);
    };
    this.awareness.on("update", this.onAwarenessLocal);
  }

  private unbindDocHandlers() {
    if (this.onDocUpdate) {
      this.ydoc.off("update", this.onDocUpdate);
    }
    if (this.onAwarenessLocal) {
      this.awareness.off("update", this.onAwarenessLocal);
    }
  }

  private resetYDoc() {
    this.unbindDocHandlers();

    try {
      this.awareness.setLocalState(null);
    } catch {
      // ignore
    }

    try {
      this.ydoc.destroy();
    } catch {
      // ignore
    }

    this.ydoc = new Y.Doc();
    this.awareness = new Awareness(this.ydoc);
    this.providerBridge = new AwarenessProviderBridge(this.awareness);

    this.setLocalAwarenessUser();
    this.bindDocHandlers();
  }

  getExtensions() {
    return [
      ...tiptapExtensions,

      Collaboration.configure({
        document: this.ydoc,
        field: "default",
      }),

      CollaborationCaret.configure({
        provider: this.providerBridge as any,
        user: {
          name: this.user.name,
          color: this.user.color ?? "#111827",
        },
        render: (user: { id?: string; name?: string; color?: string }) =>
          renderCollaborationCursor({
            userId: user.id ?? "unknown",
            name: user.name,
            color: user.color,
          }),
      }),
    ];
  }

  private requestSync() {
    if (!this.documentId) return;
    if (!this.socket.connected) return;
    if (!this.isDocJoined) return;

    const stateVector = Y.encodeStateVector(this.ydoc);
    this.socket.emit("yjs:sync_step1", {
      documentId: this.documentId,
      stateVector: u8ToArr(stateVector),
    });
  }

  private requestJoin() {
    if (!this.documentId) return;
    if (!this.socket.connected) return;

    this.isDocJoined = false;
    this.pendingJoinDocId = this.documentId;

    this.socket.emit("join_document", { documentId: this.documentId });
  }

  private bindOnce() {
    if (this.isBound) return;
    this.isBound = true;

    this.onSyncStep2 = (payload) => {
      if (!this.documentId || payload.documentId !== this.documentId) return;
      if (!Array.isArray(payload.update)) return;

      Y.applyUpdate(this.ydoc, arrToU8(payload.update), "remote");
    };
    this.socket.on("yjs:sync_step2", this.onSyncStep2);

    this.onRemoteDocUpdate = (payload) => {
      if (!this.documentId || payload.documentId !== this.documentId) return;
      if (!Array.isArray(payload.update)) return;

      Y.applyUpdate(this.ydoc, arrToU8(payload.update), "remote");
    };
    this.socket.on("yjs:update", this.onRemoteDocUpdate);

    this.onAwarenessRemote = (payload) => {
      if (!this.documentId || payload.documentId !== this.documentId) return;
      if (!Array.isArray(payload.states)) return;

      applyAwarenessUpdate(this.awareness, arrToU8(payload.states), "remote");
    };
    this.socket.on("yjs:awareness_update", this.onAwarenessRemote);

    this.onDocumentJoined = (payload) => {
      const ackDocId = payload?.documentId?.trim?.() ?? payload?.documentId;
      if (!ackDocId) return;
      if (this.pendingJoinDocId !== ackDocId) return;
      if (this.documentId !== ackDocId) return;

      this.pendingJoinDocId = null;
      this.isDocJoined = true;

      this.setLocalAwarenessUser();
      this.requestSync();
    };
    this.socket.on("document:joined", this.onDocumentJoined);

    this.onSocketConnect = () => {
      if (!this.documentId) return;
      this.requestJoin();
    };
    this.socket.on("connect", this.onSocketConnect);
  }

  start(documentId: string) {
    if (this.destroyed) return;

    this.bindOnce();

    const switchingDocs = this.documentId !== null && this.documentId !== documentId;
    this.documentId = documentId;

    this.isDocJoined = false;
    this.pendingJoinDocId = null;

    if (switchingDocs) {
      this.resetYDoc();
    } else {
      this.setLocalAwarenessUser();
    }

    if (this.socket.connected) {
      this.requestJoin();
    }
  }

  stop() {
    if (!this.documentId) return;

    const docId = this.documentId;

    this.documentId = null;
    this.isDocJoined = false;
    this.pendingJoinDocId = null;

    if (this.socket.connected) {
      this.socket.emit("leave_document", { documentId: docId });
    }

    this.awareness.setLocalState(null);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;

    this.stop();

    if (this.onSyncStep2) {
      this.socket.off("yjs:sync_step2", this.onSyncStep2);
    }
    if (this.onRemoteDocUpdate) {
      this.socket.off("yjs:update", this.onRemoteDocUpdate);
    }
    if (this.onAwarenessRemote) {
      this.socket.off("yjs:awareness_update", this.onAwarenessRemote);
    }
    if (this.onDocumentJoined) {
      this.socket.off("document:joined", this.onDocumentJoined);
    }
    if (this.onSocketConnect) {
      this.socket.off("connect", this.onSocketConnect);
    }

    this.unbindDocHandlers();

    try {
      this.ydoc.destroy();
    } catch {
      // ignore
    }
  }

  setReadOnlyState(isReadOnly: boolean) {
    this.setLocalAwarenessUser();
    this.awareness.setLocalStateField("readOnly", isReadOnly);
  }
}