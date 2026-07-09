const http=require("http"),fs=require("fs"),path=require("path");
const base=__dirname;
const dataFile=path.join(base,"data.json");

function loadData(){
  var raw=fs.readFileSync(dataFile);
  // Force UTF-8: if BOM present, strip it
  if(raw[0]===0xEF&&raw[1]===0xBB&&raw[2]===0xBF) raw=raw.slice(3);
  try{ return JSON.parse(raw.toString("utf-8"))||{}; }
  catch(e){ return {}; }
}
function saveData(obj){
  fs.writeFileSync(dataFile,JSON.stringify(obj,null,2),"utf-8");
}

http.createServer((req,res)=>{
  var url=req.url.split("?")[0];

  if(url==="/api/save" && req.method==="POST"){
    var chunks=[];
    req.on("data",function(c){ chunks.push(c); });
    req.on("end",function(){
      try{
        var body=Buffer.concat(chunks).toString("utf-8");
        var incoming=JSON.parse(body);
        var existing=loadData();
        Object.assign(existing,incoming);
        saveData(existing);
        res.writeHead(200,{"Content-Type":"application/json; charset=utf-8","Access-Control-Allow-Origin":"*"});
        res.end(JSON.stringify({ok:true}));
      }catch(e){
        res.writeHead(400,{"Content-Type":"text/plain; charset=utf-8"});
        res.end("err:"+e.message);
      }
    });
    return;
  }

  if(url==="/api/save" && req.method==="GET"){
    res.writeHead(200,{"Content-Type":"application/json; charset=utf-8","Access-Control-Allow-Origin":"*"});
    return res.end(JSON.stringify(loadData()));
  }

  if(req.method==="OPTIONS"){
    res.writeHead(204,{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET,POST,OPTIONS","Access-Control-Allow-Headers":"Content-Type"});
    return res.end();
  }

  var f=path.join(base,url==="/"?"index.html":url);
  fs.readFile(f,function(e,d){
    if(e){ res.writeHead(404,{"Content-Type":"text/plain; charset=utf-8"}); res.end("404"); }
    else{
      var ext=path.extname(f).slice(1);
      var m={"html":"text/html; charset=utf-8","js":"text/javascript; charset=utf-8","mjs":"text/javascript; charset=utf-8","css":"text/css; charset=utf-8","json":"application/json; charset=utf-8","png":"image/png","svg":"image/svg+xml; charset=utf-8"};
      res.writeHead(200,{"Content-Type":m[ext]||"text/plain; charset=utf-8","Access-Control-Allow-Origin":"*"});
      res.end(d);
    }
  });
}).listen(8766,function(){ console.log("ready"); });
