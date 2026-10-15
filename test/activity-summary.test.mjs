import {test} from 'node:test';import assert from 'node:assert/strict';
import {website} from '../src/activity-summary.mjs';
test('registrable websites merge subdomains but not public/private suffix tenants or literal IPs',()=>{
 assert.equal(website('api.openai.com'),'openai.com');assert.equal(website('cdn.example.co.uk'),'example.co.uk');assert.equal(website('a.github.io'),'a.github.io');assert.equal(website('b.github.io'),'b.github.io');assert.equal(website('8.8.8.8'),'8.8.8.8');
});
