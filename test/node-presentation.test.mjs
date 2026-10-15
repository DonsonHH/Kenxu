import {test} from 'node:test';
import assert from 'node:assert/strict';
import {groupNodes,nodePresentation,displayNodeName} from '../public/node-model.js';
test('primary SG/US groups are separate from backups and display does not rename subscription identities',()=>{
 const names=['China@US🇺🇸','Azure@US2🇺🇸','Azure@SG3🇸🇬','UK@GUSecure2🇬🇧','Azure@SG1🇸🇬','Backup@JP🇯🇵','Azure@US1🇺🇸','Azure@SG2🇸🇬'];
 const nodes=names.map((name,i)=>Object.freeze({id:String(i),name})),before=JSON.stringify(nodes),groups=groupNodes(nodes);
 assert.deepEqual(groups.map(g=>[g.id,g.nodes.length]),[['sg',3],['us',2],['other',3]]);
 assert.deepEqual(groups[0].nodes.map(n=>n.name),['Azure@SG1🇸🇬','Azure@SG2🇸🇬','Azure@SG3🇸🇬']);
 assert.equal(nodePresentation(nodes[0]).kind,'direct-unmetered');
 assert.equal(nodePresentation(nodes[0]).group,'other');
 assert.equal(nodePresentation(nodes[0]).country,'US');
 assert.equal(nodePresentation(nodes[0],{kind:'direct'}).kind,'direct','Registered managed nodes never get reclassified by name');
 assert.equal(displayNodeName('Azure@US1🇺🇸'),'Azure@US1 [US]');
 assert.equal(displayNodeName('DOMAIN,x.test,Azure@SG1🇸🇬'),'DOMAIN,x.test,Azure@SG1 [SG]');
 assert.equal(JSON.stringify(nodes),before,'The presentation model must not alter source names, IDs or ordering');
 assert.equal(groupNodes([]).length,0);
});
