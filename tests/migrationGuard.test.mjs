import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {getRemovedTemplateStoragePaths,isOnlyTemplateUrlMigration}=require('../functions/templateStorageCleanup.js');
const bucket='mlmbooster-a4887.firebasestorage.app';
const old='https://firebasestorage.googleapis.com/v0/b/'+bucket+'/o/templates%2Fshowcase%2Fexample.webp?alt=media&token=abc';
const mirrored='https://cdn.mlmposter.com/templates/showcase/example.webp';
test('same-key migration does not select Firebase object for deletion',()=>{
 assert.deepEqual(getRemovedTemplateStoragePaths({url:old},{url:mirrored},bucket),[]);
});
test('URL-only rewrite is detected for publisher skip',()=>{
 assert.equal(isOnlyTemplateUrlMigration({url:old,Active:true},{url:mirrored,Active:true},bucket),true);
});
test('metadata changes are NOT mistaken for URL-only migration',()=>{
 assert.equal(isOnlyTemplateUrlMigration({url:old,Active:true},{url:mirrored,Active:false},bucket),false);
});
test('wrong bucket is not rewritten',()=>{
 const other=old.replace(bucket,'other-bucket.firebasestorage.app');
 assert.equal(isOnlyTemplateUrlMigration({url:other},{url:mirrored},bucket),false);
});
test('different-key CDN replacement still counts as removal (preserves legacy cleanup)',()=>{
 assert.deepEqual(getRemovedTemplateStoragePaths({url:old},{url:'https://cdn.mlmposter.com/templates/showcase/different.webp'},bucket),['templates/showcase/example.webp']);
});
test('nested template links are mirrored safely',()=>{
 assert.deepEqual(getRemovedTemplateStoragePaths({GraphicsLink:[{url:old}]},{GraphicsLink:[{url:mirrored}]},bucket),[]);
});
