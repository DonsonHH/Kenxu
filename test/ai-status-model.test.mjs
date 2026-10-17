import {test} from 'node:test';
import assert from 'node:assert/strict';
import {officialEventDays} from '../public/ai-status-model.js';
const now=Date.UTC(2026,9,17,6);
const day=(date,status='unknown',incidents=0)=>({date,status,incidents,samples:0,missing:0});
test('official event view marks dates with no listed incident without inventing or modifying local samples',()=>{
 const history=Object.freeze([Object.freeze(day('2026-09-20')),Object.freeze({...day('2026-10-17'),samples:1,missing:1})]);
 const provider={lastSuccessAt:now-60000,available:true,status:'operational',history};
 const display=officialEventDays(provider,now);
 assert.deepEqual(display.map(d=>d.status),['unreported','unreported']);
 assert.deepEqual(history.map(d=>d.status),['unknown','unknown']);assert.deepEqual(display.map(d=>d.samples),[0,1]);assert.equal(display[0].missing,0);assert.notEqual(display[0],history[0]);
});
test('official warnings survive the event view; unavailable, never-read and not-yet-covered dates stay unknown',()=>{
 const provider={lastSuccessAt:now-60000,available:false,status:'unknown',history:[day('2026-09-20'),day('2026-10-12','outage'),day('2026-10-13','maintenance',1),day('2026-10-14','unknown',1),day('2026-10-17'),day('2026-10-18')]};
 assert.deepEqual(officialEventDays(provider,now).map(d=>d.status),['unreported','outage','maintenance','degraded','unknown','unknown']);
 assert.equal(officialEventDays({...provider,available:true,status:'unknown'},now).at(-2).status,'unknown','An unrecognized current official state is not a healthy day');
 assert.equal(officialEventDays({...provider,lastSuccessAt:null},now)[0].status,'unknown');
 assert.equal(officialEventDays({...provider,lastSuccessAt:now-86400000},now).at(-2).status,'unknown');
});
test('official event coverage uses Beijing calendar dates at midnight, not UTC dates',()=>{
 const afterMidnight=Date.UTC(2026,9,16,16,1),provider={lastSuccessAt:afterMidnight,available:true,status:'no-incident',history:[day('2026-10-16'),day('2026-10-17')]};
 assert.deepEqual(officialEventDays(provider,afterMidnight).map(d=>d.status),['unreported','unreported']);
 assert.deepEqual(officialEventDays({...provider,lastSuccessAt:afterMidnight-120000},afterMidnight).map(d=>d.status),['unreported','unknown']);
});
