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
    'apple_donut','apple_porridge','apple_tea','bacon_omelet','banana_smoothie','banana_split','bath_salt','beef_stew','bell_pepper_salad','berry_cake','berry_donut','berry_milkshake','berry_tea','blt_sandwich','blue_hat','blueberry_smoothie','blueberry_waffle','breakfast_bowl','breakfast_waffle','broccoli_salad','candle','cappuccino','caramel','carrot_cupcake','carrot_salad','carrot_smoothie','cheese_pasta','cheese_salad','cheese_sandwich','chicken_sandwich','chicken_taco','chili_hotdog','chocolate_cake','chocolate_donut','chocolate_pie','chocolate_waffle','clay_mug','clay_pot','cloth_shoe','cologne','cucumber_salad','cucumber_sandwich','cupcake','doner_supreme','donut','egg_salad','face_mask','fish_and_chips','fish_sandwich','fish_skewer','flower_candle','french_fries','fruit_cake','fruit_yogurt','frutti_pizza','fudge','ginger_oil','ginger_tea','gingerbread','glazed_donut','gold_bracelet','gold_voucher','green_salad','ham_sandwich','hand_pies','iron_bracelet','jasmine','kebab','lamb_skewer','lasagna','latte','lavender','lavender_oil','lemon_oil','lobster_soup','lobster_sushi','lotion','macaroon','mango_smoothie','milkshake','mint_ice_cream','mint_oil','mocha','mushroom_pie','oatmeal','omelet','onion_rings','passion_pie','pasta','peach_smoothie','peach_tart','peach_tea','peanut','peanut_fudge','peanut_milkshake','perfume','pineapple_bars','pineapple_smoothie','plum_jam','porridge','potato_salad','rice_noodle_dish','roast_beef_sandwich','rose_oil','seafood_pasta','silver_ring','spaghetti','special_taco','spicy_kebab','spicy_taco','spinach_salad','spring_rolls','stir_fry','strawberry_smoothie','strawberry_waffle','tea','tempura','tomato_salad','vase','vegetable_stew','veggie_sandwich','veggie_taco','waffle','wheat_oil','zesty_perfume'
  ];
});
