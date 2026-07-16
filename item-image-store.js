(function(root,factory){
  var api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.HayDayItemImages=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  var DB_NAME='hayday-planner-item-images';
  var STORE_NAME='itemImages';
  var DB_VERSION=1;
  var MAX_SOURCE_BYTES=8*1024*1024;
  var MAX_BACKUP_DATA_URL_CHARS=2*1024*1024;
  var TARGET_SIZE=256;

  function supported(){return typeof indexedDB!=='undefined';}
  function validId(id){return typeof id==='string'&&id.length>0&&id.length<=160;}
  function validDataUrl(value){return typeof value==='string'&&value.length<=MAX_BACKUP_DATA_URL_CHARS&&/^data:image\/(?:png|jpeg|webp);base64,/i.test(value);}
  function normalizeRecord(id,value){
    var source=value&&typeof value==='object'&&!Array.isArray(value)?value:{dataUrl:value};
    var recordId=validId(id)?id:(validId(source.id)?source.id:'');
    if(!recordId||!validDataUrl(source.dataUrl)) return null;
    return {
      id:recordId,
      dataUrl:source.dataUrl,
      mimeType:typeof source.mimeType==='string'?source.mimeType:(source.dataUrl.slice(5,source.dataUrl.indexOf(';'))||'image/webp'),
      width:Math.max(1,parseInt(source.width,10)||TARGET_SIZE),
      height:Math.max(1,parseInt(source.height,10)||TARGET_SIZE),
      updatedAt:typeof source.updatedAt==='string'&&!isNaN(Date.parse(source.updatedAt))?source.updatedAt:''
    };
  }
  function shouldReplace(existing,incoming){
    if(!existing) return true;
    var existingTime=Date.parse(existing.updatedAt||''),incomingTime=Date.parse(incoming.updatedAt||'');
    return !isNaN(existingTime)&&!isNaN(incomingTime)&&incomingTime>existingTime;
  }
  function normalizeBackup(input){
    var normalized=[];
    if(!input||typeof input!=='object') return normalized;
    if(Array.isArray(input)){
      input.forEach(function(value){var record=normalizeRecord(value&&value.id,value);if(record)normalized.push(record);});
      return normalized;
    }
    Object.keys(input).forEach(function(id){var record=normalizeRecord(id,input[id]);if(record)normalized.push(record);});
    return normalized;
  }
  function openDb(){
    return new Promise(function(resolve,reject){
      if(!supported()){reject(new Error('当前浏览器不支持本地图片库'));return;}
      var request=indexedDB.open(DB_NAME,DB_VERSION);
      request.onupgradeneeded=function(){
        var db=request.result;
        if(!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME,{keyPath:'id'});
      };
      request.onsuccess=function(){resolve(request.result);};
      request.onerror=function(){reject(request.error||new Error('无法打开本地图片库'));};
    });
  }
  function withStore(mode,action){
    return openDb().then(function(db){
      return new Promise(function(resolve,reject){
        var transaction=db.transaction(STORE_NAME,mode);
        var store=transaction.objectStore(STORE_NAME);
        var result;
        try{result=action(store);}catch(error){db.close();reject(error);return;}
        transaction.oncomplete=function(){db.close();resolve(result);};
        transaction.onerror=function(){db.close();reject(transaction.error||new Error('本地图片库操作失败'));};
        transaction.onabort=function(){db.close();reject(transaction.error||new Error('本地图片库操作已取消'));};
      });
    });
  }
  function getAll(){
    return openDb().then(function(db){
      return new Promise(function(resolve,reject){
        var transaction=db.transaction(STORE_NAME,'readonly');
        var request=transaction.objectStore(STORE_NAME).getAll();
        request.onsuccess=function(){resolve((request.result||[]).map(function(record){return normalizeRecord(record.id,record);}).filter(Boolean));};
        request.onerror=function(){reject(request.error||new Error('无法读取本地图片'));};
        transaction.oncomplete=function(){db.close();};
        transaction.onerror=function(){db.close();};
      });
    });
  }
  function put(record){
    var normalized=normalizeRecord(record&&record.id,record);
    if(!normalized) return Promise.reject(new Error('图片记录格式错误'));
    if(!normalized.updatedAt) normalized.updatedAt=new Date().toISOString();
    return withStore('readwrite',function(store){store.put(normalized);return normalized;});
  }
  function remove(id){
    if(!validId(id)) return Promise.reject(new Error('物品编号无效'));
    return withStore('readwrite',function(store){store.delete(id);return id;});
  }
  function mergeBackup(input){
    var records=normalizeBackup(input);
    if(!records.length) return Promise.resolve(0);
    return openDb().then(function(db){
      return new Promise(function(resolve,reject){
        var transaction=db.transaction(STORE_NAME,'readwrite');
        var store=transaction.objectStore(STORE_NAME);
        var applied=0;
        records.forEach(function(record){
          var request=store.get(record.id);
          request.onsuccess=function(){
            if(!shouldReplace(request.result,record)) return;
            if(!record.updatedAt) record.updatedAt=new Date().toISOString();
            store.put(record);applied++;
          };
        });
        transaction.oncomplete=function(){db.close();resolve(applied);};
        transaction.onerror=function(){db.close();reject(transaction.error||new Error('恢复本地图片失败'));};
        transaction.onabort=function(){db.close();reject(transaction.error||new Error('恢复本地图片已取消'));};
      });
    });
  }
  function exportMap(){
    return getAll().then(function(records){
      var result={};
      records.forEach(function(record){
        result[record.id]={dataUrl:record.dataUrl,mimeType:record.mimeType,width:record.width,height:record.height,updatedAt:record.updatedAt};
      });
      return result;
    });
  }
  function readFile(file){
    return new Promise(function(resolve,reject){
      var reader=new FileReader();
      reader.onload=function(){resolve(reader.result);};
      reader.onerror=function(){reject(reader.error||new Error('无法读取图片文件'));};
      reader.readAsDataURL(file);
    });
  }
  function loadImage(dataUrl){
    return new Promise(function(resolve,reject){
      var image=new Image();
      image.onload=function(){resolve(image);};
      image.onerror=function(){reject(new Error('图片无法解析'))};
      image.src=dataUrl;
    });
  }
  function prepareFile(id,file){
    if(!validId(id)) return Promise.reject(new Error('请先保存物品再上传图片'));
    if(!file||!/^image\/(?:png|jpeg|webp)$/i.test(file.type||'')) return Promise.reject(new Error('请选择 PNG、JPG 或 WebP 图片'));
    if(file.size>MAX_SOURCE_BYTES) return Promise.reject(new Error('图片不能超过 8 MB'));
    return readFile(file).then(loadImage).then(function(image){
      var canvas=document.createElement('canvas');
      canvas.width=TARGET_SIZE;canvas.height=TARGET_SIZE;
      var context=canvas.getContext('2d');
      if(!context) throw new Error('当前浏览器无法处理图片');
      context.clearRect(0,0,TARGET_SIZE,TARGET_SIZE);
      var scale=Math.min(TARGET_SIZE/image.naturalWidth,TARGET_SIZE/image.naturalHeight);
      var width=Math.max(1,Math.round(image.naturalWidth*scale));
      var height=Math.max(1,Math.round(image.naturalHeight*scale));
      context.drawImage(image,Math.round((TARGET_SIZE-width)/2),Math.round((TARGET_SIZE-height)/2),width,height);
      var dataUrl=canvas.toDataURL('image/webp',.86);
      var mimeType='image/webp';
      if(!/^data:image\/webp/i.test(dataUrl)){dataUrl=canvas.toDataURL('image/png');mimeType='image/png';}
      return {id:id,dataUrl:dataUrl,mimeType:mimeType,width:TARGET_SIZE,height:TARGET_SIZE,updatedAt:new Date().toISOString()};
    });
  }

  return {
    DB_NAME:DB_NAME,
    STORE_NAME:STORE_NAME,
    MAX_SOURCE_BYTES:MAX_SOURCE_BYTES,
    MAX_BACKUP_DATA_URL_CHARS:MAX_BACKUP_DATA_URL_CHARS,
    TARGET_SIZE:TARGET_SIZE,
    supported:supported,
    normalizeRecord:normalizeRecord,
    normalizeBackup:normalizeBackup,
    shouldReplace:shouldReplace,
    getAll:getAll,
    put:put,
    remove:remove,
    mergeBackup:mergeBackup,
    exportMap:exportMap,
    prepareFile:prepareFile
  };
});
