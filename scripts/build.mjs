import {build} from 'esbuild';
import {copyFile,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
await build({entryPoints:['src/notifications.jsx'],outfile:'public/notifications.js',bundle:true,minify:true,format:'iife',define:{'process.env.NODE_ENV':'"production"'},legalComments:'eof',plugins:[{
 name:'sonner-external-css',setup(build){build.onLoad({filter:/sonner[\\/]dist[\\/]index\.mjs$/},async({path})=>{
  const code=await readFile(path,'utf8'),matches=code.match(/^__insertCSS\(.*\);$/gm);
  if(matches?.length!==1)throw Error('Sonner style injector changed; review the external CSS build adapter');
  return {contents:code.replace(matches[0],''),loader:'js'};
 });}
}]});
await copyFile('node_modules/sonner/dist/styles.css','public/notifications.css');
await copyFile('src/policy.mjs','public/policy.js');
await build({entryPoints:['src/icons.mjs'],outfile:'public/icons.js',bundle:true,minify:true,format:'iife',legalComments:'eof'});
await build({entryPoints:['src/charts.mjs'],outfile:'public/charts.js',bundle:true,minify:true,format:'iife',legalComments:'eof'});
await writeFile('public/portal.css',(await Promise.all(['style','notifications','admin','user','charts','release','theme','rules','experience','ai-status','overlays','microinteractions','accessibility','announcements'].map(name=>readFile('public/'+name+'.css','utf8')))).join('\n'));
await build({entryPoints:['public/app.js'],outfile:'public/client.js',bundle:true,minify:true,format:'esm',legalComments:'eof',plugins:[{name:'local-browser-modules',setup(build){build.onResolve({filter:/^\/(policy|admin|activity-ui|source-ui|usage-detail|node-model|form-ui|motion|client-imports|guide-ui|rules-ui)\.js$/},args=>({path:path.resolve('public',args.path.slice(1))}));}}]});
