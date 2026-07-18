(function(root,factory){
  var api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.HayDayCatalogMigration=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  var CATALOG_ID_VERSION=2;
  var ITEM_IDS=/* CATALOG_ITEM_IDS */{"apple_donut":"bacon_donut","apple_tea":"apple_ginger_tea","bacon_eggs":"bacon_and_eggs","banana_smoothie":"cucumber_smoothie","bath_salt":"exfoliating_soap","bell_pepper_salad":"summer_salad","berry_cake":"red_berry_cake","berry_donut":"filled_donut","berry_tea":"iced_tea","blt_sandwich":"veggie_bagel","blue_hat":"blue_wolly_hat","blueberries":"blueberry","blueberry_smoothie":"plum_smoothie","broccoli_salad":"bean_salad","butter_popcorn":"buttered_popcorn","carrot_salad":"pasta_salad","carrot_smoothie":"tropical_smoothie","cheese_pasta":"pasta_carbonara","cheese_salad":"coleslaw","cheese_sandwich":"honey_toast","chicken_sandwich":"cucumber_sandwich","chicken_taco":"spicy_bean_taco","chocolate_donut":"crunchy_donut","cloth_shoe":"sweater","cucumber_salad":"veggie_platter","cucumber_sandwich":"hummus_wrap","cupcake":"plain_cupcake","donut":"plain_donut","egg_salad":"summer_rolls","face_mask":"honey_face_mask","fish_sandwich":"peanut_butter_and_jelly_sandwich","fish_taco":"taco","flower_candle":"colorful_candles","french_fries":"bacon_fries","frutti_pizza":"frutti_di_mare_pizza","fudge":"rich_fudge","ginger_tea":"pomegranate_tea","gingerbread":"gingerbread_cookie","glazed_donut":"cream_donut","green_salad":"feta_salad","ham_sandwich":"onion_melt","hotdog":"hot_dog","lasagna":"gnocchi","latte":"caffe_latte","lavender_oil":"chamomile_essential_oil","lemon_oil":"lemon_essential_oil","mango_smoothie":"black_sesame_smoothie","milkshake":"vanilla_milkshake","mint_oil":"mint_essential_oil","mocha":"caffe_mocha","mushroom_pie":"mushroom_pot_pie","omelet":"colourful_omelet","onion_rings":"falafel","passion_pie":"passion_fruit_pie","pasta":"fresh_pasta","peach_smoothie":"mixed_smoothie","peanut":"peanuts","peanut_milkshake":"peanut_butter_milkshake","pineapple_bars":"pineapple_coconut_bars","pineapple_smoothie":"cocoa_smoothie","potato_salad":"blt_salad","rice_noodle_dish":"lobster_pasta","roast_beef_sandwich":"goat_cheese_toast","roasted_tomato":"roasted_tomatoes","seafood_pasta":"spicy_pasta","soybean":"soyabean","spaghetti":"broccoli_pasta","special_taco":"nachos","spicy_taco":"quesadilla","spinach_salad":"orange_salad","spring_rolls":"samosa","strawberry_smoothie":"yogurt_smoothie","strawberry_waffle":"berry_waffle","tea":"orange_tea","tempura":"fried_candy_bar","tnt":"tnt_barrel","tomato_salad":"seafood_salad","veggie_sandwich":"bacon_toast","veggie_taco":"fish_taco","waffle":"plain_waffle","wheat_oil":"ginger_essential_oil"};
  var BUILDING_IDS=/* CATALOG_BUILDING_IDS */{"candy_maker":"candy_machine","essential_oils":"essential_oils_lab","hotdog_stand":"hot_dog_stand","jewelry_maker":"jeweler","preservation":"preservation_station"};

  function clone(value){
    return value==null?value:JSON.parse(JSON.stringify(value));
  }
  function hasOwn(object,key){
    return Object.prototype.hasOwnProperty.call(object,key);
  }
  function mapItemId(id){
    return typeof id==='string'&&hasOwn(ITEM_IDS,id)?ITEM_IDS[id]:id;
  }
  function mapBuildingId(id){
    return typeof id==='string'&&hasOwn(BUILDING_IDS,id)?BUILDING_IDS[id]:id;
  }
  function remapObjectKeys(value,mapId,label){
    if(!value||typeof value!=='object'||Array.isArray(value))return value;
    var result={};
    Object.keys(value).forEach(function(sourceId){
      var targetId=mapId(sourceId);
      if(hasOwn(result,targetId))throw new Error((label||'数据')+'编号迁移冲突: '+sourceId+' → '+targetId);
      result[targetId]=clone(value[sourceId]);
    });
    return result;
  }
  function uniqueMappedIds(values,mapId){
    var result=[];
    (Array.isArray(values)?values:[]).forEach(function(id){
      var mapped=mapId(id);
      if(typeof mapped==='string'&&result.indexOf(mapped)<0)result.push(mapped);
    });
    return result;
  }
  function migrateIngredients(ingredients){
    return (Array.isArray(ingredients)?ingredients:[]).map(function(ingredient){
      var next=clone(ingredient);
      if(next&&typeof next==='object')next.i=mapItemId(next.i);
      return next;
    });
  }
  function migrateItemRecord(item){
    if(!item||typeof item!=='object'||Array.isArray(item))return clone(item);
    var next=clone(item);
    if(typeof next.id==='string')next.id=mapItemId(next.id);
    if(typeof next.bld==='string')next.bld=mapBuildingId(next.bld);
    if(Array.isArray(next.ing))next.ing=migrateIngredients(next.ing);
    return next;
  }
  function migrateInventory(inventory){
    return remapObjectKeys(inventory,mapItemId,'库存');
  }
  function migrateChecked(checked){
    return remapObjectKeys(checked,mapItemId,'核对状态');
  }
  function migrateEdits(edits){
    if(!edits||typeof edits!=='object'||Array.isArray(edits))return clone(edits);
    var next=clone(edits);
    var modified=remapObjectKeys(next.mod||{},mapItemId,'物品修改');
    Object.keys(modified).forEach(function(id){
      modified[id]=migrateItemRecord(modified[id]);
      if(modified[id]&&typeof modified[id]==='object')delete modified[id].id;
    });
    next.mod=modified;
    next.add=(Array.isArray(next.add)?next.add:[]).map(migrateItemRecord);
    next.del=uniqueMappedIds(next.del,mapItemId);
    return next;
  }
  function migrateItemOrders(orders){
    if(!orders||typeof orders!=='object'||Array.isArray(orders))return clone(orders);
    var result={};
    Object.keys(orders).forEach(function(sourceId){
      var targetId=mapBuildingId(sourceId);
      if(hasOwn(result,targetId))throw new Error('物品排序编号迁移冲突: '+sourceId+' → '+targetId);
      result[targetId]=uniqueMappedIds(orders[sourceId],mapItemId);
    });
    return result;
  }
  function migrateFilterOrder(order){
    return (Array.isArray(order)?order:[]).map(function(entry){
      if(!entry||typeof entry!=='object'||Array.isArray(entry))return clone(entry);
      var next=clone(entry);
      if(typeof next.bld==='string')next.bld=mapBuildingId(next.bld);
      return next;
    });
  }
  function migrateBuildingOrder(order){
    return uniqueMappedIds(order,mapBuildingId);
  }
  function migrateImageMap(images){
    var result=remapObjectKeys(images,mapItemId,'用户图片');
    if(result&&typeof result==='object'&&!Array.isArray(result)){
      Object.keys(result).forEach(function(id){
        if(result[id]&&typeof result[id]==='object'&&typeof result[id].id==='string')result[id].id=id;
      });
    }
    return result;
  }
  function migrateEditHistory(history){
    if(!Array.isArray(history))return clone(history);
    return history.map(function(entry){
      if(!entry||typeof entry!=='object'||Array.isArray(entry))return clone(entry);
      var next=clone(entry);
      if(typeof next.itemId==='string')next.itemId=mapItemId(next.itemId);
      [
        ['edits',migrateEdits],
        ['checked',migrateChecked],
        ['targets',migrateInventory]
      ].forEach(function(rule){
        if(typeof next[rule[0]]!=='string')return;
        var parsed=JSON.parse(next[rule[0]]);
        next[rule[0]]=JSON.stringify(rule[1](parsed));
      });
      return next;
    });
  }
  function migrateBackupData(data){
    if(!data||typeof data!=='object'||Array.isArray(data))return clone(data);
    var next=clone(data);
    if(Number(next.catalogIdVersion)>=CATALOG_ID_VERSION)return next;
    if(next.items&&typeof next.items==='object'&&!Array.isArray(next.items))next.items=migrateInventory(next.items);
    if(next.edits!=null)next.edits=migrateEdits(next.edits);
    if(next.checked!=null)next.checked=migrateChecked(next.checked);
    if(next.itemOrders!=null)next.itemOrders=migrateItemOrders(next.itemOrders);
    if(next.filterOrder!=null)next.filterOrder=migrateFilterOrder(next.filterOrder);
    if(next.order!=null)next.order=migrateBuildingOrder(next.order);
    if(next.itemImages!=null)next.itemImages=migrateImageMap(next.itemImages);
    next.version=Math.max(4,Number(next.version)||0);
    next.catalogIdVersion=CATALOG_ID_VERSION;
    return next;
  }
  function parseAndMigrate(value,migrator,key){
    try{return JSON.stringify(migrator(JSON.parse(value)));}
    catch(error){throw new Error(key+' 迁移失败: '+error.message);}
  }
  function migrateStoredValues(snapshot){
    var source=snapshot&&typeof snapshot==='object'&&!Array.isArray(snapshot)?snapshot:{};
    var values=Object.assign({},source);
    var changedKeys=[];
    if(String(values.hd_catalog_id_version||'')===String(CATALOG_ID_VERSION)){
      return {values:values,changedKeys:changedKeys,migrated:false};
    }
    var rules={
      hd_inv:migrateInventory,
      hd_edits:migrateEdits,
      hd_checked:migrateChecked,
      hd_item_orders:migrateItemOrders,
      hd_filter_order:migrateFilterOrder,
      hd_order:migrateBuildingOrder
    };
    Object.keys(rules).forEach(function(key){
      if(typeof values[key]!=='string')return;
      var migrated=parseAndMigrate(values[key],rules[key],key);
      if(migrated!==values[key]){values[key]=migrated;changedKeys.push(key);}
    });
    if(typeof values.hayday_local_edit_history_v1==='string'){
      var history=parseAndMigrate(values.hayday_local_edit_history_v1,migrateEditHistory,'修改恢复记录');
      if(history!==values.hayday_local_edit_history_v1){
        values.hayday_local_edit_history_v1=history;
        changedKeys.push('hayday_local_edit_history_v1');
      }
    }
    if(typeof values._hd_server_pending==='string'){
      var pending;
      try{pending=JSON.parse(values._hd_server_pending);}
      catch(error){throw new Error('待同步数据迁移失败: '+error.message);}
      if(pending&&typeof pending==='object'&&!Array.isArray(pending)){
        var pendingResult=migrateStoredValues(pending);
        var pendingText=JSON.stringify(pendingResult.values);
        if(pendingText!==values._hd_server_pending){
          values._hd_server_pending=pendingText;
          changedKeys.push('_hd_server_pending');
        }
      }
    }
    values.hd_catalog_id_version=String(CATALOG_ID_VERSION);
    if(changedKeys.indexOf('hd_catalog_id_version')<0)changedKeys.push('hd_catalog_id_version');
    return {values:values,changedKeys:changedKeys,migrated:true};
  }

  return {
    CATALOG_ID_VERSION:CATALOG_ID_VERSION,
    ITEM_IDS:ITEM_IDS,
    BUILDING_IDS:BUILDING_IDS,
    mapItemId:mapItemId,
    mapBuildingId:mapBuildingId,
    migrateIngredients:migrateIngredients,
    migrateItemRecord:migrateItemRecord,
    migrateInventory:migrateInventory,
    migrateChecked:migrateChecked,
    migrateEdits:migrateEdits,
    migrateItemOrders:migrateItemOrders,
    migrateFilterOrder:migrateFilterOrder,
    migrateBuildingOrder:migrateBuildingOrder,
    migrateImageMap:migrateImageMap,
    migrateEditHistory:migrateEditHistory,
    migrateBackupData:migrateBackupData,
    migrateStoredValues:migrateStoredValues
  };
});
