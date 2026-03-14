// apps/realtime/src/sync/yjsAdapter.ts

import type { Server, Socket } from "socket.io";
import * as Y from "yjs";
import { YjsDocStore } from "./yjsDocStore";

function toUint8Array(arr: number[]): Uint8Array {
  return Uint8Array.from(arr);
}

function fromUint8Array(u8: Uint8Array): number[] {
  return Array.from(u8);
}

type AwarenessUpdatePayload = {
  documentId: string;
  added: number[];
  updated: number[];
  removed: number[];
  states: number[];
};

const MAX_DOC_UPDATE_BYTES = 2 * 1024 * 1024; // 2MB
const MAX_AWARENESS_BYTES = 1 * 1024 * 1024; // 1MB

const docObservers = new Map<string, { ydoc: Y.Doc; unsubscribe: () => void }>();

function ensureDocObserver(io: Server, store: YjsDocStore, documentId: string) {
  // If observer exists but the store doc was cleaned up, remove stale observer entry.
  const existing = docObservers.get(documentId);
  if (existing && !store.has(documentId)) {
    try {
      existing.unsubscribe();
    } catch {
      // ignore
    }
    docObservers.delete(documentId);
  }

  if (docObservers.has(documentId)) return;

  const ydoc = store.getOrCreate(documentId);

  const onUpdate = (update: Uint8Array, origin: unknown) => {
    const originSocketId =
      typeof origin === "string" && origin.length > 0 ? origin : undefined;

    const originUserId =
      originSocketId && (io.sockets.sockets.get(originSocketId)?.data as any)
        ? ((io.sockets.sockets.get(originSocketId)?.data as any).userId as
            | string
            | undefined)
        : undefined;

    const room = io.to(documentId);
    const roomExceptOrigin = originSocketId ? room.except(originSocketId) : room;

    roomExceptOrigin.emit("yjs:update", {
      documentId,
      update: fromUint8Array(update),
      originUserId,
    });

    store.touch(documentId);
  };

  ydoc.on("update", onUpdate);

  docObservers.set(documentId, {
    ydoc,
    unsubscribe: () => ydoc.off("update", onUpdate),
  });
}

export function registerYjsAdapter(io: Server, socket: Socket, store: YjsDocStore) {
  socket.on("yjs:sync_step1", (payload: { documentId: string; stateVector: number[] }) => {
    try {
      const { documentId, stateVector } = payload ?? {};
      if (!documentId || !Array.isArray(stateVector)) return;
      if (!socket.rooms.has(documentId)) return;

      ensureDocObserver(io, store, documentId);

      const ydoc = store.getOrCreate(documentId);
      const sv = toUint8Array(stateVector);
      const update = Y.encodeStateAsUpdate(ydoc, sv);

      socket.emit("yjs:sync_step2", {
        documentId,
        update: fromUint8Array(update),
      });
    } catch {
      return;
    }
  });

  socket.on("yjs:update", (payload: { documentId: string; update: number[] }) => {
    try {
      const { documentId, update } = payload ?? {};
      if (!documentId || !Array.isArray(update)) return;
      if (!socket.rooms.has(documentId)) return;

      if (update.length > MAX_DOC_UPDATE_BYTES) return;

      ensureDocObserver(io, store, documentId);

      const ydoc = store.getOrCreate(documentId);
      const u8 = toUint8Array(update);

      Y.applyUpdate(ydoc, u8, socket.id);
    } catch {
      return;
    }
  });

  socket.on("yjs:awareness_update", (payload: AwarenessUpdatePayload) => {
    try {
      const { documentId, added, updated, removed, states } = payload ?? ({} as any);
      if (!documentId) return;
      if (!socket.rooms.has(documentId)) return;

      if (!Array.isArray(added) || !Array.isArray(updated) || !Array.isArray(removed)) return;
      if (!Array.isArray(states)) return;

      if (states.length > MAX_AWARENESS_BYTES) return;

      io.to(documentId).except(socket.id).emit("yjs:awareness_update", {
        documentId,
        added,
        updated,
        removed,
        states,
      } satisfies AwarenessUpdatePayload);
    } catch {
      return;
    }
  });

  socket.on("disconnect", () => {});
}