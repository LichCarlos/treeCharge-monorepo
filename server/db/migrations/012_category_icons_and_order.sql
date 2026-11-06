SET search_path = charge, pg_catalog;
ALTER TABLE category_tags ADD COLUMN icon_id text NOT NULL DEFAULT 'other';
UPDATE category_tags SET icon_id=CASE
  WHEN name ~ '早餐' THEN 'breakfast'
  WHEN name ~ '咖啡' THEN 'coffee'
  WHEN name ~ '饮料|奶茶' THEN 'drinks'
  WHEN name ~ '零食' THEN 'snacks'
  WHEN name ~ '水果' THEN 'fruit'
  WHEN name ~ '蔬菜|买菜' THEN 'vegetables'
  WHEN name ~ '饮食|餐|吃|食品' THEN 'food'
  WHEN name ~ '地铁' THEN 'subway'
  WHEN name ~ '打车|出租车' THEN 'taxi'
  WHEN name ~ '火车|高铁' THEN 'train'
  WHEN name ~ '交通|通勤|车' THEN 'transport'
  WHEN name ~ '水电' THEN 'utilities'
  WHEN name ~ '物业' THEN 'property'
  WHEN name ~ '住房|房租|房' THEN 'housing'
  WHEN name ~ '话费|通信|通讯' THEN 'phone'
  WHEN name ~ '洗护|日用|用品' THEN 'daily'
  WHEN name ~ '保险' THEN 'insurance'
  WHEN name ~ '医|健康' THEN 'medical'
  WHEN name ~ '旅行|出行' THEN 'travel'
  WHEN name ~ '电子|数码' THEN 'electronics'
  WHEN name ~ '运动' THEN 'sport'
  WHEN name ~ '衣|服|鞋' THEN 'clothes'
  WHEN name ~ '购物|购' THEN 'shopping'
  WHEN name ~ '娱乐|社交|随心' THEN 'entertainment'
  WHEN name ~ '人情|礼' THEN 'gifts'
  WHEN name ~ '备用|应急' THEN 'emergency'
  WHEN name ~ '储蓄|存|挑战' THEN 'savings'
  WHEN name ~ '红包' THEN 'red-packet'
  WHEN name ~ '工资|收入|薪' THEN 'salary'
  WHEN name ~ '奖金|年终' THEN 'bonus'
  WHEN name ~ '租金' THEN 'rent-income'
  WHEN name ~ '分红' THEN 'dividend'
  WHEN name ~ '理财' THEN 'investment'
  WHEN name ~ '学习|书' THEN 'study'
  ELSE 'other' END;
ALTER TABLE category_tags ADD CONSTRAINT category_icon_valid CHECK (icon_id IN ('food','shopping','daily','transport','vegetables','fruit','snacks','sport','entertainment','phone','clothes','beauty','housing','utilities','medical','insurance','travel','gifts','study','electronics','salary','red-packet','rent-income','gift-money','dividend','investment','bonus','side-job','reimbursement','other-income','savings','emergency','goal','coffee','drinks','breakfast','groceries','water','dessert','other','car','taxi','subway','train','bicycle','fuel','parking','boat','hotel','navigation','furniture','repair','cleaning','appliances','moving','property','plants','heating','internet','storage','medicine','hospital','checkup','dentist','care','eyewear','baby','children','parents','pet','movie','music','singing','photography','art','basketball','football','tennis','swim','camping','education','stationery','course','exam','subscription','software','mobile-device','headphones','watch','accessory','social','charity','wedding','festival','tax','fee','loan','interest','sale','refund'));
WITH ranked AS (
  SELECT c.id,row_number() OVER(PARTITION BY c.ledger_id ORDER BY t.position,c.name,c.id)-1 AS ordinal
  FROM category_tags c JOIN tree_nodes t USING(id,workspace_id)
)
UPDATE tree_nodes t SET position=r.ordinal FROM ranked r WHERE t.id=r.id;
