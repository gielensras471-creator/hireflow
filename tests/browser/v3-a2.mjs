// Reuse the full accepted production UI chain, changing only transport and observations.
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
const output = path.resolve(process.argv[2])
await fs.mkdir(output, { recursive: true })
let source = (await fs.readFile('tests/browser/v3-production.mjs', 'utf8')).replace(/\r\n/g, '\n')
source = source.replace(
  "from './refine-list-checks.mjs'",
  'from ' + JSON.stringify(pathToFileURL(path.resolve('tests/browser/refine-list-checks.mjs')).href)
)
source = source.replace(
  'let running = await startV3Server(env)',
  `
const {localTls}=await import(root('tests/browser/local-tls.mjs'))
const tls=localTls()
const {createServer:tlsServer}=await import('node:https')
const {request:proxyRequest}=await import('node:http')
const {default:express}=await import(root('node_modules/express/index.js'))
const listen=s=>new Promise(r=>s.listen(0,'127.0.0.1',()=>r(s)))
const internalUrl='http://127.0.0.1:'+serverPort
const proxyLog=[]
const apiTls=await listen(tlsServer(tls,(req,res)=>{
 const u=proxyRequest(internalUrl+req.url,{method:req.method,headers:req.headers},up=>{res.writeHead(up.statusCode,up.headers);up.pipe(res);proxyLog.push({method:req.method,path:req.url,status:up.statusCode,origin:req.headers.origin,idempotency:!!req.headers['idempotency-key'],authorization:!!req.headers.authorization})});u.on('error',()=>{res.writeHead(502);res.end()});req.pipe(u)
}))
const apiOrigin='https://127.0.0.1:'+apiTls.address().port
const frontend=express()
const built=join(profile,'dist-a2')
frontend.use(express.static(built));frontend.get('*',(_req,res)=>res.sendFile(join(built,'index.html')))
const frontTls=await listen(tlsServer(tls,frontend))
const frontendOrigin='https://127.0.0.1:'+frontTls.address().port
process.env.VITE_HIREFLOW_V3_API_URL=apiOrigin+'/api/v3'
const {build}=await import(root('node_modules/vite/dist/node/index.js'))
await build({mode:'v3-production',build:{outDir:built}})
env.V3_CLIENT_ORIGINS=frontendOrigin
delete env.V3_STATIC_DIR
let running = await startV3Server(env)
`
)
source = source.replace("url: 'http://127.0.0.1:' + serverPort", 'url: frontendOrigin')
source = source.replace(
  "    '--headless=new',",
  "    '--headless=new',\n    '--ignore-certificate-errors-spki-list='+tls.spki,"
)
source = source
  .replaceAll("fetch(app.url + '/api/v3", "fetch(internalUrl + '/api/v3")
  .replace('httpGet(app.url + route', 'httpGet(internalUrl + route')
source = source.replace(
  '    await running.close()\n  }',
  '    await running.close()\n    apiTls.closeAllConnections();frontTls.closeAllConnections();await new Promise(r=>apiTls.close(r))\n    await new Promise(r=>frontTls.close(r))\n  }'
)
source = source
  .replace('const browserExceptions = []', 'const browserExceptions = []\nconst securityErrors=[]')
  .replace(
    "    if (m.method === 'Network.requestWillBeSent')",
    "    if(m.method==='Log.entryAdded'&&/CORS|Mixed Content|Access-Control/i.test(m.params.entry.text))securityErrors.push(m.params.entry.text)\n    if (m.method === 'Network.requestWillBeSent')"
  )
  .replace("send('Network.enable'),", "send('Network.enable'),send('Log.enable'),")
source = source.replace(
  '  assert.equal(audit.v2Requests, 0)',
  `

  const crossRead=async(path,method='GET',body,authenticated=true)=>evaluate('(async()=>{const token=JSON.parse(localStorage.getItem("hireflow_v3_session")).token;const r=await fetch('+JSON.stringify(apiOrigin+'/api/v3')+'+'+JSON.stringify(path)+',{method:'+JSON.stringify(method)+',headers:{'+(authenticated?'Authorization:"Bearer "+token,':'')+'"Content-Type":"application/json","Idempotency-Key":"a2-browser-conflict"},'+(body?'body:'+JSON.stringify(JSON.stringify(body)):'')+'});const data=await r.json();return {status:r.status,code:data.error?.code,requestId:data.error?.requestId}})()')
  const negative=[]
  negative.push(await crossRead('/positions','GET',null,false));assert.equal(negative[0].status,401)
  negative.push(await crossRead('/positions/1','PATCH',{expectedVersion:999,title:'虚构冲突不得写入'}));assert.equal(negative[1].status,409)
  const beforeDenied=db.prepare('SELECT count(*) n FROM business_events').get().n
  db.exec("UPDATE users SET role='viewer' WHERE id=1")
  try{negative.push(await crossRead('/positions'));assert.equal(negative[2].status,403)}finally{db.exec("UPDATE users SET role='hr' WHERE id=1")}
  assert.equal(db.prepare('SELECT count(*) n FROM business_events').get().n,beforeDenied)
  assert.ok(negative.every(x=>x.requestId))

  const origins=[...new Set(requests.filter(u=>new URL(u).pathname.startsWith('/api/')).map(u=>new URL(u).origin))]
  assert.deepEqual(origins,[apiOrigin]);assert.deepEqual(securityErrors,[]);assert.ok(proxyLog.every(x=>!x.path.includes("/api/v3/api/v3")))
  assert.ok(proxyLog.some(x=>x.method==='OPTIONS'&&x.status===204))
  assert.ok(proxyLog.some(x=>x.method==='POST'&&x.authorization&&x.idempotency))
  await writeFile(join(output,'a2-cross-origin.json'),JSON.stringify({sha,mode:'production',frontendOrigin,apiOrigin,actualApiOrigins:origins,negativeBrowserResponses:negative,securityErrors,localCertificate:'ephemeral self-signed; Chromium trusts only this SPKI; not public HTTPS verification',proxyLog,coreSteps:11,auxSteps:4,events:all.business_events.length,receipts:all.command_receipts.length,v2Requests:audit.v2Requests,browserExceptions,browserHttp5xx:audit.http5xx},null,2))
  assert.equal(audit.v2Requests, 0)`
)
source = source.replace(
  '} finally {\n  ws?.close()',
  ` } catch(error) {
  try { await snapshot('failure');await writeFile(join(output,'failure-page.json'),JSON.stringify({url:await evaluate('location.href'),title:await evaluate('document.title'),text:await evaluate('document.body.innerText.slice(0,500)')})) } catch {}
  throw error
} finally {
  ws?.close()`
)
if (
  !source.includes('apiTls.closeAllConnections()') ||
  !source.includes('negativeBrowserResponses:negative')
)
  throw new Error('A2 harness transformation incomplete')
const generated = path.join(
  await fs.mkdtemp(path.join(os.tmpdir(), 'a2-script-')),
  'production-chain.mjs'
)
await fs.writeFile(generated, source)
const child = spawn(process.execPath, [generated, output], { stdio: 'inherit', windowsHide: true })
child.once('exit', (code) => {
  process.exitCode = code ?? 1
})
