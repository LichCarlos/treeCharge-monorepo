// Stable IDs are shared by the API and all category displays. Artwork uses Ionicons.
const rows=[
 ['food','餐饮','restaurant-outline','饮食'],['shopping','购物','bag-handle-outline','生活'],
 ['daily','日用','basket-outline','生活'],['transport','交通','bus-outline','出行'],
 ['vegetables','蔬菜','leaf-outline','饮食'],['fruit','水果','nutrition-outline','饮食'],
 ['snacks','零食','fast-food-outline','饮食'],['sport','运动','fitness-outline','娱乐'],
 ['entertainment','娱乐','game-controller-outline','娱乐'],['phone','通讯','call-outline','生活'],
 ['clothes','服饰','shirt-outline','生活'],['beauty','美容','color-palette-outline','生活'],
 ['housing','住房','home-outline','居住'],['utilities','水电','flash-outline','居住'],
 ['medical','医疗','medkit-outline','健康'],['insurance','保险','shield-checkmark-outline','健康'],
 ['travel','旅行','airplane-outline','出行'],['gifts','礼物','gift-outline','人情'],
 ['study','学习','book-outline','学习'],['electronics','数码','laptop-outline','生活'],
 ['salary','工资','cash-outline','收入'],['red-packet','红包','mail-outline','收入'],
 ['rent-income','租金','business-outline','收入'],['gift-money','礼金','heart-outline','收入'],
 ['dividend','分红','people-outline','收入'],['investment','理财','stats-chart-outline','收入'],
 ['bonus','奖金','trophy-outline','收入'],['side-job','兼职','briefcase-outline','收入'],
 ['reimbursement','报销','receipt-outline','收入'],['other-income','其他收入','add-circle-outline','收入'],
 ['savings','储蓄','wallet-outline','储蓄'],['emergency','备用金','lock-closed-outline','储蓄'],
 ['goal','目标','flag-outline','储蓄'],['coffee','咖啡','cafe-outline','饮食'],
 ['drinks','饮料','beer-outline','饮食'],['breakfast','早餐','sunny-outline','饮食'],
 ['groceries','买菜','cart-outline','饮食'],['water','饮水','water-outline','饮食'],
 ['dessert','甜点','ice-cream-outline','饮食'],['other','其他','pricetag-outline','生活'],
 ['car','汽车','car-outline','出行'],['taxi','打车','car-sport-outline','出行'],
 ['subway','地铁','subway-outline','出行'],['train','火车','train-outline','出行'],
 ['bicycle','骑行','bicycle-outline','出行'],['fuel','加油','speedometer-outline','出行'],
 ['parking','停车','navigate-circle-outline','出行'],['boat','轮渡','boat-outline','出行'],
 ['hotel','住宿','bed-outline','出行'],['navigation','路费','navigate-outline','出行'],
 ['furniture','家具','file-tray-full-outline','居住'],['repair','维修','construct-outline','居住'],
 ['cleaning','清洁','sparkles-outline','居住'],['appliances','家电','tv-outline','居住'],
 ['moving','搬家','cube-outline','居住'],['property','物业','key-outline','居住'],
 ['plants','绿植','flower-outline','居住'],['heating','燃气供暖','flame-outline','居住'],
 ['internet','宽带','wifi-outline','居住'],['storage','收纳','albums-outline','居住'],
 ['medicine','药品','bandage-outline','健康'],['hospital','医院','medical-outline','健康'],
 ['checkup','体检','pulse-outline','健康'],['dentist','牙科','happy-outline','健康'],
 ['care','护理','hand-left-outline','健康'],['eyewear','眼镜','glasses-outline','健康'],
 ['baby','母婴','accessibility-outline','家庭'],['children','孩子','balloon-outline','家庭'],
 ['parents','父母','people-circle-outline','家庭'],['pet','宠物','paw-outline','家庭'],
 ['movie','电影','film-outline','娱乐'],['music','音乐','musical-notes-outline','娱乐'],
 ['singing','唱歌','mic-outline','娱乐'],['photography','摄影','camera-outline','娱乐'],
 ['art','绘画','brush-outline','娱乐'],['basketball','篮球','basketball-outline','娱乐'],
 ['football','足球','football-outline','娱乐'],['tennis','网球','tennisball-outline','娱乐'],
 ['swim','游泳','water','娱乐'],['camping','露营','bonfire-outline','娱乐'],
 ['education','学费','school-outline','学习'],['stationery','文具','pencil-outline','学习'],
 ['course','课程','easel-outline','学习'],['exam','考试','document-text-outline','学习'],
 ['subscription','订阅','newspaper-outline','生活'],['software','软件','apps-outline','生活'],
 ['mobile-device','手机','phone-portrait-outline','生活'],['headphones','耳机','headset-outline','生活'],
 ['watch','手表','watch-outline','生活'],['accessory','饰品','diamond-outline','生活'],
 ['social','聚会','chatbubbles-outline','人情'],['charity','捐赠','heart-circle-outline','人情'],
 ['wedding','婚庆','rose-outline','人情'],['festival','节日','ribbon-outline','人情'],
 ['tax','税费','calculator-outline','财务'],['fee','手续费','card-outline','财务'],
 ['loan','还款','swap-horizontal-outline','财务'],['interest','利息','trending-up-outline','收入'],
 ['sale','闲置出售','storefront-outline','收入'],['refund','退款','return-down-back-outline','财务']
];
export const categoryIcons=Object.freeze(rows.map(([id,label,glyph,group])=>Object.freeze({id,label,glyph,group})));
const lookup=new Map(categoryIcons.map(icon=>[icon.id,icon]));
export const categoryIconIds=Object.freeze(categoryIcons.map(icon=>icon.id));
export const defaultIconRules=[
 ['早餐','breakfast'],['咖啡','coffee'],['饮料|奶茶','drinks'],['零食','snacks'],['水果','fruit'],['蔬菜|买菜','vegetables'],
 ['饮食|餐|吃|食品','food'],['地铁','subway'],['打车|出租车','taxi'],['火车|高铁','train'],['交通|通勤|车','transport'],
 ['水电','utilities'],['物业','property'],['住房|房租|房','housing'],['话费|通信|通讯','phone'],
 ['洗护|日用|用品','daily'],['保险','insurance'],['医|健康','medical'],['旅行|出行','travel'],
 ['电子|数码','electronics'],['运动','sport'],['衣|服|鞋','clothes'],['购物|购','shopping'],
 ['娱乐|社交|随心','entertainment'],['人情|礼','gifts'],['备用|应急','emergency'],['储蓄|存|挑战','savings'],
 ['红包','red-packet'],['工资|收入|薪','salary'],['奖金|年终','bonus'],['租金','rent-income'],['分红','dividend'],
 ['理财','investment'],['学习|书','study']
];
export function inferCategoryIcon(name=''){return defaultIconRules.find(([pattern])=>new RegExp(pattern).test(name))?.[1]??'other';}
export function resolveCategoryIcon(category){return lookup.get(category?.icon_id??category?.iconId)??lookup.get(inferCategoryIcon(typeof category==='string'?category:category?.name??category?.category_name));}
export function moveCategory(categories,id,offset){const next=[...categories],from=next.findIndex(c=>c.id===id);if(from<0)return next;const to=Math.max(0,Math.min(next.length-1,from+offset));next.splice(to,0,...next.splice(from,1));return next;}

export function categoryIconBindings(categories,ledgerIds){const scope=new Set(ledgerIds),counts=new Map();for(const c of categories)if(scope.has(c.ledger_id)){const id=resolveCategoryIcon(c).id;counts.set(id,(counts.get(id)??0)+1);}return counts;}
