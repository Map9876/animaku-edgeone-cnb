import http from 'node:http'
import { readFileSync, existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const port = Number(process.argv[2] || 8899)
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.webp':'image/webp', '.woff2':'font/woff2', '.wasm':'application/wasm', '.ico':'image/x-icon' }
http.createServer((req,res)=>{let u;try{u=decodeURIComponent(new URL(req.url,'http://x').pathname)}catch{u='/'}
let f=path.join(root,u);if(!f.startsWith(root)){res.writeHead(403);return res.end()}
if(!existsSync(f)||statSync(f).isDirectory())f=path.join(root,'index.html')
if(!existsSync(f)){res.writeHead(404);return res.end()}
res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream','Cache-Control':'no-store'});res.end(readFileSync(f))
}).listen(port,()=>console.log('dev '+port))
