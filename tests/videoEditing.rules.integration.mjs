import { test } from "node:test";
import { readFile } from "node:fs/promises";
import {
  initializeTestEnvironment,
  assertFails,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import assert from "node:assert/strict";
test("Production rules protect video records and credit balances for each client role", async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST || "";
  assert.match(
    host,
    /^127\.0\.0\.1:\d+$/,
    "Run only against the local emulator.",
  );
  const env = await initializeTestEnvironment({
    projectId: "demo-mlmlive-video",
    firestore: {
      host: "127.0.0.1",
      port: Number(host.split(":")[1]),
      rules: await readFile(
        new URL("../firestore.rules", import.meta.url),
        "utf8",
      ),
    },
  });
  try {
    const clients = [
      env.unauthenticatedContext(),
      env.authenticatedContext("mobile_9876543210", { mobileNo: "9876543210" }),
      env.authenticatedContext("ve_test", { panel: "video-team" }),
      env.authenticatedContext("master", {
        panel: "admin",
        actorType: "owner",
        role: "Master Admin",
      }),
    ];
    const paths = [
      "videoService/test/requests/test",
      "videoService/test/requests/test/history/step",
      "videoService/test/drafts/test",
      "videoService/test/views/team/entries/test",
      "_videoEditingTeam/ve_test",
      "paymentEntitlements/any",
    ];
    for (const client of clients) {
      const db = client.firestore();
      for (const path of paths) {
        const ref = doc(db, path);
        await assertFails(getDoc(ref));
        await assertFails(
          setDoc(ref, { active: true, credit: "consumed", role: "manager" }),
        );
      }
    }
  } finally {
    await env.cleanup();
  }
});
