(function(root,factory){
  var ids=factory();
  if(typeof module==='object'&&module.exports) module.exports=ids;
  else{
    root.HAYDAY_PLACEHOLDER_ICON_IDS=ids;
    root.HAYDAY_PLACEHOLDER_ICONS=ids.reduce(function(result,id){result[id]=true;return result;},{});
  }
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  // 这些内置资源是低体积通用占位图，不应计为真实物品图片。
  return [
    'bacon_omelet','beef_stew','berry_milkshake','candle','cappuccino','caramel','carrot_cupcake','chili_hotdog','clay_pot','cologne','doner_supreme','fruit_yogurt','ginger_oil','gold_bracelet','jasmine','kebab','lamb_skewer','lavender','lotion','oatmeal','peach_tea','perfume','porridge','rose_oil','silver_ring','spicy_kebab','stir_fry','vase','vegetable_stew'
  ];
});
