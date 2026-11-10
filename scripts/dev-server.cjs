'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const base=path.join(__dirname,'..');
const routes={'/api/member-auth':require('../api/member-auth.js'),'/api/journal-report':require('../api/journal-report.js'),'/api/journal-admin':require('../api/journal-admin.js'),'/api/shop-feed':require('../api/shop-feed.js')};
const server=http.createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(routes[pathname]){
    let length=0,body='';for await(const chunk of req){length+=chunk.length;if(length>100000){res.writeHead(413);res.end();return;}body+=chunk;}
    req.body=body||undefined;res.status=code=>{res.statusCode=code;return res;};res.json=data=>{res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(data));return res;};
    try{await routes[pathname](req,res);}catch{res.status(500).json({error:'Internal error'});}return;
  }
  const relative=pathname==='/'?'index.html':pathname.slice(1);
  if(!(relative==='index.html'||/^assets\/[a-z0-9-]+\.(css|js)$/.test(relative))){res.writeHead(404);res.end('Not found');return;}
  try{const file=fs.readFileSync(path.join(base,relative));res.setHeader('Content-Type',relative.endsWith('.css')?'text/css; charset=utf-8':relative.endsWith('.js')?'application/javascript; charset=utf-8':'text/html; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(file);}catch{res.writeHead(404);res.end('Not found');}
});
const port=Number(process.env.PORT)||4173;
server.listen(port,'127.0.0.1',()=>console.log('Bloom Journal: http://127.0.0.1:'+port));
