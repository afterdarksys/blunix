// UI integration against an in-memory API fixture. No production requests.
// Requires Playwright + Chromium: node tests/portal-browser.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { Decrypter } from '../portal/vendor/age-encryption.js';

const root = resolve(new URL('../portal', import.meta.url).pathname);
const server = createServer(async (req, res) => {
  try {
    const path = resolve(root, '.' + (req.url === '/' ? '/index.html' : req.url.split('?')[0]));
    if (!path.startsWith(root + '/')) throw Error();
    const bytes = await readFile(path);
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
    res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream' }); res.end(bytes);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
try {
  const page = await browser.newPage();
  const errors=[]; page.on('pageerror', e => errors.push(e.message));
  const configs = new Map(); let hosts=[], upload=null;
  await page.route('https://api.blunix.io/**', async route => {
    const req=route.request(), url=new URL(req.url()), path=url.pathname.slice(3), method=req.method();
    const headers={ 'access-control-allow-origin': req.headers().origin || '*', 'access-control-allow-credentials':'true', 'access-control-allow-headers':'content-type,x-blunix-csrf', 'access-control-allow-methods':'GET,POST,DELETE' };
    let status=200, data={};
    if (method==='OPTIONS') { await route.fulfill({status:204,headers}); return; }
    const body=req.headers()['content-type']==='application/json'?req.postDataJSON():null;
    if (path==='/me') data={account:{id:'fixture-account'}};
    else if(path==='/keys') data={keys:[]};
    else if(path==='/hosts' && method==='GET') data={hosts};
    else if(path==='/hosts' && method==='POST') { hosts.push({label:body.label,latest:null}); status=201; data={label:body.label}; }
    else if(path.endsWith('/builds') && method==='POST') {
      upload=req.postDataBuffer(); const sha256=createHash('sha256').update(upload).digest('hex');
      status=201; data={version:1,sha256,pinnedUrl:null};
    } else if(path==='/configurations' && method==='POST') {
      const id=String(configs.size+1), source=body.source;
      const recipe=source?configs.get(source.id).revisions.find(r=>r.revision===source.revision).recipe:body.recipe;
      data={id,title:body.title,revision:1,visibility:'private',source:source||null,revisions:[{revision:1,recipe,message:''}]}; configs.set(id,data); status=201;
    } else if(path==='/configurations' || path==='/community') data={configurations:[...configs.values()].filter(c=>path==='/configurations'||c.visibility==='public'),nextOffset:null};
    else {
      const parts=path.split('/'), c=configs.get(parts[2]);
      if(!c) {status=404;data={error:'not found'};}
      else if(parts[3]==='publication') {c.visibility=body.visibility;data={visibility:c.visibility};}
      else if(parts[3]==='revisions') {c.revision++;c.revisions.unshift({revision:c.revision,recipe:body.recipe,message:body.message});data={id:c.id,revision:c.revision};status=201;}
      else data=c;
    }
    await route.fulfill({status,headers,contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.locator('#signed-in').waitFor({state:'visible'});
  await page.locator('#reserve-label').fill('testmachine');
  await page.getByRole('button',{name:'Reserve',exact:true}).click();
  await page.locator('#build-label').selectOption('testmachine');
  await page.locator('input[name="package"][value="git"]').check();
  const ssh='ssh-ed25519 '+Buffer.concat([Buffer.from('0000000b7373682d6564323535313900000020','hex'),Buffer.alloc(32,7)]).toString('base64');
  await page.locator('#admin-key').fill(ssh);
  await page.locator('#install-target').fill('TEST-SERIAL');
  await page.locator('#install-erase').check();
  await page.locator('#configuration-title').fill('Developer tools');
  await page.locator('#configuration-save').click();
  await page.locator('#configurations').getByRole('heading',{name:'Developer tools'}).waitFor();
  page.on('dialog', d=>d.accept());
  await page.locator('#configurations').getByRole('button',{name:'Share publicly'}).click();
  await page.locator('#community').getByRole('button',{name:'View revisions'}).click();
  await page.locator('#community').getByRole('button',{name:'Fork revision 1'}).click();
  await page.waitForFunction(()=>document.getElementById('configurations').children.length===2);
  await page.locator('input[name="package"][value="curl"]').check();
  await page.locator('#configuration-message').fill('Add curl');
  await page.locator('#configuration-revise').click();
  await page.waitForFunction(()=>document.getElementById('configuration-editing').textContent.includes('revision 2'));
  await page.locator('#build-submit').click();
  await page.locator('#card').waitFor({state:'visible',timeout:60000});
  assert.ok(upload);
  const key=(await page.locator('#card-key .group').allTextContents()).join('');
  const decrypter=new Decrypter(); decrypter.addPassphrase(key);
  const plaintext=new TextDecoder().decode(await decrypter.decrypt(new Uint8Array(upload)));
  assert.match(plaintext,/target: "TEST-SERIAL"/);
  assert.match(plaintext,/packages: \["curl","git"\]|packages: \["git","curl"\]/);
  assert.match(plaintext,/erase: true/);
  for(const c of configs.values()) for(const rev of c.revisions) assert.deepEqual(Object.keys(rev.recipe).sort(),['access','packages']);
  assert.deepEqual(errors,[]);
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false,'mobile horizontal overflow');
  await page.locator('#close-card').click();
  assert.equal(await page.locator('#card-key').textContent(),'');
  console.log('Portal browser: reserve → configure → save → share → fork → revise → encrypt → decrypt verified; mobile layout and key clearing passed.');
} finally { await browser.close(); await new Promise(r=>server.close(r)); }
