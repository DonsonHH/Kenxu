import {test} from 'node:test';
import assert from 'node:assert/strict';
import {httpResponseMs} from '../public/node-model.js';
test('user response display accepts only measured HTTP response timing, never legacy total or unavailable timings',()=>{
 const measured={status:'normal',latencyMetric:'http-response-v2',latency:86,setupMs:266,totalMs:352};
 assert.equal(httpResponseMs(measured),86);assert.equal(httpResponseMs({...measured,latency:0}),0);
 for(const value of [null,{...measured,latencyMetric:'http-total-v1'},{...measured,latencyMetric:null},{...measured,status:'stale'},{...measured,status:'failed'},{...measured,latency:-1},{...measured,latency:NaN},{...measured,latency:Infinity},{...measured,latency:'86'}])assert.equal(httpResponseMs(value),null);
 assert.equal(measured.totalMs,352);assert.equal(measured.setupMs,266);
});
