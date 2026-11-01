import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { createAdminReadCache } from '../src/Utils/adminReadCache.js';
const require = createRequire(import.meta.url);
const { createTemplateAssetCleanupQueue, QUEUE_COLLECTION } = require('../functions/templateAssetCleanupQueue.js');

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
test('Admin collection reads deduplicate, expire and stay isolated by authenticated UID', async () => {
  let time = 1, calls = 0;
  const cache = createAdminReadCache({ now: () => time, ttlMs: 100 });
  const load = async () => [{ id: String(++calls) }];
  await Promise.all([cache.get('admin', 'templates', load), cache.get('admin', 'templates', load)]);
  await cache.get('admin', 'templates', load); assert.equal(calls, 1);
  await cache.get('other', 'templates', load); assert.equal(calls, 2);
  time = 102; await cache.get('admin', 'templates', load); assert.equal(calls, 3);
  await cache.get('admin', 'templates', load, { force: true }); assert.equal(calls, 4);
  cache.clear(); await cache.get('admin', 'templates', load); assert.equal(calls, 5);
});

test('a confirmed Admin edit updates the list without another read and supersedes an older refresh', async () => {
  const cache = createAdminReadCache();
  await cache.get('admin', 'templates', async () => [{ id: 'one', name: 'before' }]);
  cache.change('admin', 'templates', rows => rows.map(row => ({ ...row, name: 'after' })));
  assert.equal((await cache.get('admin', 'templates', () => assert.fail('unnecessary read')))[0].name, 'after');
  const old = deferred();
  const request = cache.get('admin', 'templates', () => old.promise, { force: true });
  await Promise.resolve(); cache.clear();
  old.resolve([{ id: 'stale' }]); await request;
  assert.equal(cache.peek('admin', 'templates'), undefined);
});

test('Admin cache rejects failed loads and oversized results; company invalidation leaves another admin untouched', async () => {
  const cache = createAdminReadCache({ maxRows: 1 });
  await assert.rejects(cache.get('admin', 'bad', async () => { throw Error('offline'); }));
  assert.equal(cache.peek('admin', 'bad'), undefined);
  await cache.get('admin', 'large', async () => [{}, {}]); assert.equal(cache.peek('admin', 'large'), undefined);
  for (const uid of ['admin', 'other']) await cache.get(uid, 'templates:company:a', async () => [{ id: 'one' }]);
  cache.invalidatePrefix('admin', 'templates:company:');
  assert.equal(cache.peek('admin', 'templates:company:a'), undefined);
  assert.equal(cache.peek('other', 'templates:company:a').length, 1);
});

const bucket = 'example.appspot.com';
const storageUrl = key => `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(key)}?alt=media`;
function queueHarness(templates = []) {
  let time = 1000, revision = 0;
  const queue = new Map(), reads = [];
  const timestamp = milliseconds => ({ milliseconds, toMillis: () => milliseconds });
  const Timestamp = { fromMillis: timestamp };
  function refFor(id) {
    return { id, async delete(options) {
      if (queue.get(id)?.version !== options.lastUpdateTime) throw Object.assign(Error('requeued'), { code: 9 });
      queue.delete(id);
    } };
  }
  const db = {
    batch() {
      const ops = [];
      return { set(ref, data) { ops.push([ref.id, data]); }, async commit() {
        for (const [id, data] of ops) queue.set(id, { data, version: ++revision });
      } };
    },
    collection(name) {
      const filters = [];
      let size = Infinity;
      const query = {
        doc: refFor,
        where(field, operator, value) { filters.push([field, value]); return query; },
        orderBy() { return query; }, limit(count) { size = count; return query; },
        async get() {
          reads.push(name);
          if (name === 'mlmtemplate') return { docs: templates.map(data => ({ data: () => data })) };
          assert.equal(name, QUEUE_COLLECTION);
          const rows = [...queue.entries()].filter(([, row]) => filters.every(([field, value]) => row.data[field].milliseconds <= value.milliseconds));
          return { docs: rows.slice(0, size).map(([id, row]) => ({ id, ref: refFor(id), updateTime: row.version, data: () => row.data })) };
        },
      };
      return query;
    },
  };
  const service = createTemplateAssetCleanupQueue({ db, Timestamp, now: () => time });
  const deleted = [];
  const options = { storageBucket: bucket, r2Bucket: 'media', collectR2Keys: data => data.r2 || [],
    removeStorage: async key => { deleted.push(['storage', key]); }, removeR2: async key => { deleted.push(['r2', key]); } };
  return { service, queue, reads, deleted, options, advance: () => { time += 16 * 60 * 1000; } };
}

test('many removals require one template scan; copied and migrated images remain available', async () => {
  const h = queueHarness([{ Active: false, r2: ['templates/shared/a.webp', 'templates/migrated/a.webp'],
    GraphicsLink: [{ url: storageUrl('templates/shared/firebase.webp') }] }]);
  await h.service.enqueue('r2', ['templates/shared/a.webp', 'templates/orphan/a.webp', 'templates/orphan/a.webp'], 'media');
  await h.service.enqueue('storage', ['templates/shared/firebase.webp', 'templates/migrated/a.webp', 'templates/orphan/firebase.webp'], bucket);
  assert.equal(h.queue.size, 5);
  assert.equal((await h.service.drain(h.options)).scans, 0); // Grace period.
  h.advance();
  const result = await h.service.drain(h.options);
  assert.deepEqual({ scans: result.scans, deleted: result.deleted, retained: result.retained, failed: result.failed },
    { scans: 1, deleted: 2, retained: 3, failed: 0 });
  assert.equal(h.reads.filter(name => name === 'mlmtemplate').length, 1);
  assert.deepEqual(h.deleted, [['r2', 'templates/orphan/a.webp'], ['storage', 'templates/orphan/firebase.webp']]);
  assert.equal(h.queue.size, 0);
  assert.equal((await h.service.drain(h.options)).scans, 0);
});

test('failed deletes remain durable, invalid paths are ignored, and changed buckets never delete objects', async () => {
  const h = queueHarness();
  assert.equal(await h.service.enqueue('r2', ['profiles/a.webp', 'templates/../bad', 'templates/good.webp'], 'media'), 1);
  h.advance();
  const failed = await h.service.drain({ ...h.options, removeR2: async () => { throw Object.assign(Error('network'), { code: 'unavailable' }); } });
  assert.equal(failed.failed, 1); assert.equal(h.queue.size, 1);
  const wrongBucket = await h.service.drain({ ...h.options, r2Bucket: 'different' });
  assert.equal(wrongBucket.invalid, 1); assert.equal(h.deleted.length, 0);
  assert.equal((await h.service.drain(h.options)).deleted, 1); assert.equal(h.queue.size, 0);
});

test('a new removal queued during cleanup survives the older acknowledgement', async () => {
  const h = queueHarness();
  await h.service.enqueue('r2', ['templates/image.webp'], 'media'); h.advance();
  const result = await h.service.drain({ ...h.options, removeR2: async () => {
    await h.service.enqueue('r2', ['templates/image.webp'], 'media');
  } });
  assert.equal(result.failed, 1);
  assert.equal(h.queue.size, 1);
});
