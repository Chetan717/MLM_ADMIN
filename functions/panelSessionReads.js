"use strict";

const SESSION_PAGE_SIZE = 30;

async function latestActorSession(db, ownerId, actorId) {
  const snapshot = await db.collection("_panelSessions")
    .where("ownerId", "==", ownerId).where("actorId", "==", actorId)
    .orderBy("createdAt", "desc").limit(1).get();
  return snapshot.docs[0] || null;
}

async function sessionPage(db, { ownerId, actorId, cursor, Timestamp, FieldPath }) {
  let query = db.collection("_panelSessions").where("ownerId", "==", ownerId);
  if (actorId) query = query.where("actorId", "==", actorId);
  query = query.orderBy("createdAt", "desc").orderBy(FieldPath.documentId(), "desc");
  if (cursor) query = query.startAfter(new Timestamp(cursor.seconds, cursor.nanoseconds), cursor.id);
  const snapshot = await query.limit(SESSION_PAGE_SIZE + 1).get();
  const documents = snapshot.docs.slice(0, SESSION_PAGE_SIZE);
  const last = documents.at(-1);
  const timestamp = last?.data().createdAt;
  const nextCursor = snapshot.docs.length > SESSION_PAGE_SIZE && timestamp ? {
    id: last.id, seconds: timestamp.seconds, nanoseconds: timestamp.nanoseconds,
  } : null;
  return { documents, nextCursor };
}

function validSessionCursor(cursor) {
  return cursor && typeof cursor.id === "string" && /^[^/]{1,128}$/.test(cursor.id)
    && cursor.id !== "." && cursor.id !== ".."
    && Number.isSafeInteger(cursor.seconds) && cursor.seconds >= 0 && cursor.seconds <= 253402300799
    && Number.isInteger(cursor.nanoseconds) && cursor.nanoseconds >= 0 && cursor.nanoseconds < 1000000000;
}

module.exports = { latestActorSession, sessionPage, validSessionCursor };
