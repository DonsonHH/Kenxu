import {test} from 'node:test';import assert from 'node:assert/strict';import {mergeDaily,routeRanking,statusCounts,activeUsageDays} from '../public/chart-model.js';
test('chart aggregates preserve exact bytes and unknown status; logical nodes are not merged into physical-core totals',()=>{
 const users=[{daily:[{date:'2026-10-01',up:10,down:100}],routes:[{meterId:'sg',month:{up:10,down:100}},{meterId:'uk',month:{up:20,down:200}}]},{daily:[{date:'2026-10-01',up:20,down:200}],routes:[{meterId:'sg',month:{up:5,down:50}}]}];
 assert.deepEqual(mergeDaily(users),[{date:'2026-10-01',up:30,down:300}]);const ranking=routeRanking(users,[{id:'sg',name:'SG'},{id:'uk',name:'UK'}]);assert.equal(ranking[0].name,'UK');assert.equal(ranking[1].down,150);assert.deepEqual(statusCounts([{status:'normal'},{status:'stale'},{status:'pending'},{status:'failed'}]),{normal:1,failed:1,unknown:2});
});
test('the usage detail lists only active dates newest first without losing bytes or compressing the chart timeline',()=>{
 const days=[{date:'2026-10-12',up:0,down:0},{date:'2026-10-13',up:1,down:0},{date:'2026-10-14',up:0,down:0},{date:'2026-10-15',up:0,down:4096}];
 assert.deepEqual(activeUsageDays(days),[days[3],days[1]]);assert.equal(days.length,4);assert.deepEqual(days.map(d=>d.date),['2026-10-12','2026-10-13','2026-10-14','2026-10-15']);assert.deepEqual(activeUsageDays(days.map(d=>({...d,up:0,down:0}))),[]);
});
