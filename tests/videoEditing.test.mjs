import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(
  new URL("../functions/package.json", import.meta.url),
);
const V = require("./video/domain"),
  D = require("./paymentDomain");
const grant = {
  purchaseId: "original",
  serviceType: "video",
  startsAtMs: 100,
  expiresAtMs: 200,
  remainingCredits: 1,
  creditLimit: 1,
};
const ledger = (g) => ({ grants: [g] });
for (const [label, changes] of Object.entries({
  poster: { serviceType: "poster" },
  legacy: { serviceType: undefined },
  future: { startsAtMs: 199 },
  expired: { expiresAtMs: 130 },
  revoked: { revoked: true },
  unconfigured: { remainingCredits: null },
  exhausted: { remainingCredits: 0 },
  reserved: { reservedVideoCredits: 1 },
})) {
  test("Reservation denied for " + label, () =>
    assert.throws(() =>
      V.credit(ledger({ ...grant, ...changes }), "reserve", 150),
    ),
  );
}
for (const kind of ["video", "combo", "poster"]) {
  test("Use actual " + kind + " purchase grants", () => {
    const l = D.nextEntitlement(
      null,
      {
        id: "purchase",
        plan: {
          serviceType: kind,
          Day_value: 30,
          videoCredits: 3,
          downloads: 9,
        },
        uid: "owner",
      },
      100,
    );
    assert.equal(V.balance(l, 101).available, kind === "poster" ? 0 : 3);
  });
}
test("An expired held credit survives renewal and can be settled", () => {
  let l = V.credit(ledger(grant), "reserve", 150).ledger;
  l = D.nextEntitlement(
    l,
    {
      id: "new",
      plan: { serviceType: "video", Day_value: 1, videoCredits: 2 },
    },
    40 * 86400000,
  );
  l = V.credit(l, "consume", 41 * 86400000, "original").ledger;
  assert.equal(
    l.grants.find((g) => g.purchaseId === "original").remainingCredits,
    0,
  );
  assert.equal(
    l.grants.find((g) => g.purchaseId === "new").remainingCredits,
    2,
  );
});
test("Accept valid Drive forms and retain a file's resource key", () => {
  assert.equal(
    V.drive("https://drive.google.com/open?id=abcdefghijk&resourcekey=a-123"),
    "https://drive.google.com/file/d/abcdefghijk/view?resourcekey=a-123",
  );
  for (const link of [
    "http://drive.google.com/file/d/abcdefghijk/view",
    "https://drive.google.com.example/file/d/abcdefghijk/view",
    "https://drive.google.com/drive/folders/abcdefghijk",
  ])
    assert.throws(() => V.drive(link));
});
test("Five clips of 150 MB each accepted, sixth or oversized clip rejected", () => {
  const f = { type: "video/mp4", name: "clip.mp4", size: 150000000 };
  assert.equal(V.manifest(Array(5).fill(f)).length, 5);
  for (const files of [
    [],
    Array(6).fill(f),
    [{ ...f, size: 150000001 }],
    [{ ...f, type: "text/html" }],
  ])
    assert.throws(() => V.manifest(files));
});
test("R2 multipart signatures bind the upload, part number and expected length", async () => {
  const store = require("./video/storage").storage({
    account: "a".repeat(32),
    access: "local-test",
    secret: "dummy",
    bucket: "private-test",
  });
  const url = new URL(
    await store.sign(
      { key: "test/file.mp4", size: V.PART + 20, uploadId: "test-upload" },
      2,
    ),
  );
  assert.equal(url.searchParams.get("partNumber"), "2");
  assert.equal(url.searchParams.get("uploadId"), "test-upload");
  assert.match(
    url.searchParams.get("X-Amz-SignedHeaders"),
    /(^|;)content-length(;|$)/,
  );
  assert.equal(url.searchParams.get("X-Amz-Expires"), "600");
  assert.equal(
    new URL(await store.download({ key: "test/file.mp4" })).searchParams.get(
      "X-Amz-Expires",
    ),
    "300",
  );
});
test("R2 finalize validates remote parts, video size and bounded container header, and reconciles a lost success response", async () => {
  const f = { key: "file.mp4", size: 20, type: "video/mp4", uploadId: "id" };
  let size = 19,
    complete = false,
    headType = f.type;
  const client = {
    async send(cmd) {
      switch (cmd.constructor.name) {
        case "ListPartsCommand":
          if (complete)
            throw Object.assign(Error(), {
              $metadata: { httpStatusCode: 404 },
            });
          return { Parts: [{ ETag: "x", Size: size, PartNumber: 1 }] };
        case "CompleteMultipartUploadCommand":
          complete = true;
          return {};
        case "HeadObjectCommand":
          return { ContentLength: f.size, ContentType: headType };
        case "GetObjectCommand":
          assert.equal(cmd.input.Range, "bytes=0-31");
          return {
            Body: {
              transformToByteArray: async () => Buffer.from("0000ftypisom"),
            },
          };
        default:
          throw Error("Unexpected R2 operation");
      }
    },
  };
  const store = require("./video/storage").storage(
    {
      account: "a".repeat(32),
      access: "dummy",
      secret: "dummy",
      bucket: "private",
    },
    client,
  );
  await assert.rejects(() => store.finish(f));
  assert.equal(complete, false);
  size = 20;
  await store.finish(f);
  await store.finish(f);
  headType = "text/html";
  await assert.rejects(() => store.finish(f));
});

test('archive is admin-only, terminal and non-destructive; restore retains state', () => {
  const row = { status: 'Completed', mobile: '9876543210', rawDeleted: false, credit: 'consumed', link: 'https://drive.google.com/file/d/abcdefghijk/view' };
  const change = V.transition(row, 'archive', {mobile:row.mobile}, 'admin', 123);
  assert.deepEqual(change, {archived:true,archivedAt:123});
  assert.throws(()=>V.transition(row,'archive',{mobile:row.mobile},'manager',123));
  assert.throws(()=>V.transition({...row,status:'Editing'},'archive',{mobile:row.mobile},'admin',123));
  assert.deepEqual(V.transition({...row,...change},'restore',{},'admin',124),{archived:false,restoredAt:124});
  assert.throws(()=>V.transition({...row,...change,deleting:true},'restore',{},'admin',124));
});
test('raw preview accepts only bounded JPEG data, never a remote link or SVG',()=>{
  const image='data:image/jpeg;base64,'+Buffer.from([255,216,255,217]).toString('base64');
  assert.equal(V.thumbnail(image),image);
  assert.equal(V.thumbnail(undefined),'');
  for(const invalid of ['https://example.com/test.jpg','data:image/svg+xml;base64,AAAA','data:image/jpeg;base64,AAAA','data:image/jpeg;base64,'+'A'.repeat(12001)]) assert.throws(()=>V.thumbnail(invalid));
});
