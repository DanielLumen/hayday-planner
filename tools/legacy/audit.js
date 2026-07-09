const fs=require("fs"),path=require("path");
const ROOT=path.resolve(__dirname,"../..");
let ERR=0,WARN=0,PASS=0;

function ok(s){PASS++;console.log("  \u2713 "+s);}
function warn(s){WARN++;console.log("  \u26A0 "+s);}
function fail(s){ERR++;console.log("  \u2717 "+s);}

console.log("\n===== 1. FILE STRUCTURE =====");
const idx=fs.readFileSync(path.join(ROOT,"index.html"),"utf8");
const buf=fs.readFileSync(path.join(ROOT,"index.html"));
buf[0]===0x3C?ok("No BOM"):fail("BOM detected at byte 0");
idx.startsWith("<!DOCTYPE")?ok("DOCTYPE html"):fail("Missing DOCTYPE");
idx.indexOf('charset="UTF-8"')>0||idx.indexOf("charset=UTF-8")>0?ok("UTF-8 charset"):fail("Missing charset UTF-8");
idx.indexOf("</html>")>0?ok("</html> present"):fail("Missing </html>");

const bodyStart=idx.indexOf("<body>");
const scriptStart=idx.indexOf("<script>",bodyStart);
var styleEnd=idx.indexOf('</style>');var head=idx.slice(0,styleEnd+8);var bodyHtml=idx.slice(styleEnd+8,scriptStart);var body=bodyHtml;
const dOp=(body.match(/<div\s/gi)||[]).length;
const dCl=(body.match(/<\/div>/gi)||[]).length;
dOp===dCl?ok("Div balance: "+dOp+"/"+dCl):fail("Div slight mismatch (known): "+dOp+" open / "+dCl+" close");

const cssStart=idx.indexOf("<style>");
const cssEnd=idx.indexOf("</style>");
const css=idx.slice(cssStart+7,cssEnd);
const cssRules=(css.match(/\{[^}]+\}/g)||[]).length;
cssRules>0?ok("CSS rules: "+cssRules):fail("No CSS rules");
css.indexOf("font-size:0")===-1?ok("No font-size:0"):warn("font-size:0 found");

console.log("\n===== 2. JAVASCRIPT SYNTAX =====");
const js=idx.slice(scriptStart+8,idx.lastIndexOf("</script>"));
try{new Function(js);ok("JS syntax valid")}catch(e){fail("JS syntax error: "+e.message.slice(0,80))}
js.indexOf("use strict")>0?ok("use strict present"):fail("Missing 'use strict'");
const varC=(js.match(/\bvar\s+\w/g)||[]).length;
const constC=(js.match(/\bconst\s+\w/g)||[]).length;
const letC=(js.match(/\blet\s+\w/g)||[]).length;
constC===0&&letC===0?warn("No const/let, "+varC+" vars"):ok("let/const: "+constC+"const "+letC+"let, "+varC+"var");

console.log("\n===== 3. KEY FUNCTIONS =====");
var funcs=["init","renderAll","updateStats","calcPriority","calcProductionPlan","calcBuyRecommendations","computeRecursiveNeeds","loadFromFile","saveToFile","openEditModal","saveItem","deleteItem","toggleInfoBar","switchSidebarTab","renderItemsList","renderHardest","renderFilters","buildChainTree","buildChainSummary","chainDepth","applyEdits","loadEdits","saveEdits"];
funcs.forEach(function(f){
  js.indexOf("function "+f+"(")>0?ok("function "+f):fail("MISSING: "+f);
});

console.log("\n===== 4. DOM APPEND FIX =====");
js.indexOf("document.body.appendChild(inp)")>0?ok("DOM append fix present"):fail("MISSING: DOM append fix");

console.log("\n===== 5. TYPE GUARD =====");
js.indexOf("typeof S[k]===")>0?ok("S[k] type guard present"):fail("MISSING: S[k] type guard");

console.log("\n===== 6. SILO/BARN CAP FIX =====");
js.indexOf("data.siloCap!=null")>0&&js.indexOf("data.barnCap!=null")>0?ok("siloCap/barnCap import fix present"):fail("MISSING: siloCap/barnCap fix");

console.log("\n===== 7. DEAD CODE =====");
js.indexOf("function renderChainView")===-1?ok("renderChainView removed"):fail("renderChainView still present");

console.log("\n===== 8. DUPLICATE CSS =====");
const b1=css.indexOf(".buy-banner{background:linear-gradient(135deg,#1a1a2e");
const b2=css.indexOf(".buy-banner{background:linear-gradient(135deg,#1a1a2e",b1+10);
b2===-1?ok("No duplicate .buy-banner"):fail("Duplicate .buy-banner block found");

console.log("\n===== 9. DATA MODEL =====");
const im={};try{const dataMatch=js.match(/var D=\{[\s\S]*?^var S/m);if(dataMatch){eval(dataMatch[0].replace("var D=","D="))}}catch(e){}
try{
  var dIdx=js.indexOf("var D={");
  var dEnd=js.indexOf("var S,",dIdx);
  if(dIdx>=0&&dEnd>=0){
    var dCode=js.slice(dIdx+4,dEnd);
    var _D=null; try{eval("_D="+dCode)}catch(e){};
  }
}catch(e){fail("Cannot parse data: "+e.message.slice(0,60))}

if(_D&&_D.items&&_D.items.length>0){
  ok("Items loaded: "+D.items.length);
  var badItems=[];
  _D.items.forEach(function(it,i){
    if(!it.id) badItems.push("Item#"+i+" no id");
    if(!it.nameCN) badItems.push(it.id+" no nameCN");
    if(!it.hasOwnProperty("ing")) badItems.push(it.id+" no ing[]");
    if(it.t==null||it.t===undefined) badItems.push(it.id+" no t (time)");
    if(!it.tg) badItems.push(it.id+" no tg (target)");
    if(!it.st) badItems.push(it.id+" no st");
  });
  badItems.length===0?ok("All items valid"):badItems.slice(0,5).forEach(fail);
  
  var badIngRefs=[];
  var itemIds=_D.items.map(function(it){return it.id});
  _D.items.forEach(function(it){
    (it.ing||[]).forEach(function(ing){
      if(itemIds.indexOf(ing.i)===-1) badIngRefs.push(it.id+" -> unknown: "+ing.i);
    });
  });
  badIngRefs.length===0?ok("All ingredient refs valid"):badIngRefs.slice(0,5).forEach(fail);
  
  var bldIds=(_D.buildings||[]).map(function(b){return b.id});
  bldIds.length>0?ok("Buildings: "+bldIds.length):warn("No buildings");
  _D.items.forEach(function(it){
    if(it.bld&&bldIds.indexOf(it.bld)===-1) badItems.push(it.id+" -> unknown bld: "+it.bld);
  });
} else {fail("No items in data model")}

console.log("\n===== 10. PROD_MULTIPLIERS =====");
js.indexOf("PROD_MULTIPLIERS={")>0?ok("PROD_MULTIPLIERS defined"):warn("PROD_MULTIPLIERS not found");

console.log("\n===== 11. ICONS =====");
js.indexOf("ICONS={")>0?ok("ICONS object present"):warn("ICONS not found");

console.log("\n===== 12. PROJECT FILES =====");
fs.existsSync(path.join(ROOT,".nojekyll"))?ok(".nojekyll present"):fail(".nojekyll MISSING");
fs.existsSync(path.join(ROOT,"server.js"))?ok("server.js present"):fail("server.js MISSING");
fs.existsSync(path.join(ROOT,"data.json"))?ok("data.json present"):fail("data.json MISSING");
fs.existsSync(path.join(ROOT,"node_modules/pinyin-pro/dist/index.js"))?ok("pinyin-pro installed"):warn("pinyin-pro not installed");

console.log("\n===== 13. DATA.JSON =====");
try{
  const dj=JSON.parse(fs.readFileSync(path.join(ROOT,"data.json"),"utf8"));
  dj.hd_inv?ok("data.json has hd_inv"):fail("data.json missing hd_inv");
  const inv=dj.hd_inv?JSON.parse(dj.hd_inv):{};
  const invKeys=Object.keys(inv).filter(function(k){return k[0]!=="_"});
  invKeys.length>0?ok("hd_inv items: "+invKeys.length):warn("hd_inv has no items");
  dj.hd_edits?ok("data.json has hd_edits"):warn("data.json missing hd_edits");
  dj.hd_checked?ok("data.json has hd_checked"):warn("data.json missing hd_checked");
}catch(e){fail("data.json parse: "+e.message.slice(0,60))}

const total=ERR+WARN+PASS;
console.log("\n========================================");
console.log("  RESULTS: "+PASS+" passed, "+WARN+" warnings, "+ERR+" errors");
console.log("  Score: "+Math.round(PASS/total*100)+"% ("+PASS+"/"+total+")");
console.log("========================================\n");
process.exit(ERR>0?1:0);
