// 邏輯測試：抽出 index.html 的 [LOGIC-START]~[LOGIC-END] 純邏輯區，喺 node 跑斷言
// 用法：node test.js
const fs = require("fs");
const html = fs.readFileSync(__dirname + "/index.html", "utf8");
const m = html.match(/\/\/ \[LOGIC-START\][^\n]*\n([\s\S]*?)\/\/ \[LOGIC-END\]/);
if (!m) { console.error("FAIL: 找不到 LOGIC 區塊"); process.exit(1); }

// 邏輯區需要的常數（同 index.html 一致）
const prelude = "const COLS = 12, ROWS = 10;";
const exportsList = [
  "T", "TERRAIN_INFO", "parseMap", "findTile", "TYPES", "ROSTERS", "makeUnit",
  "unitAt", "livingUnits", "reachableTiles", "effectiveRng", "targetsInRange",
  "computeDamage", "spawnPositions"
];
const L = new Function(prelude + m[1] + `; return { ${exportsList.join(", ")} };`)();

let passed = 0, failed = 0;
function assert(cond, name) {
  if (cond) { passed++; console.log("  ✓ " + name); }
  else { failed++; console.error("  ✗ FAIL: " + name); }
}

// ===== 地圖解析 =====
const map = L.parseMap([
  "PPFFPPPPMMPP", "PPPFPPPPPMPP", "PPPPPRRPPPPP", "PFPPPRRRPPFP", "PPPPPPRRPPPP",
  "P1PPPPRRPP2P", "PPPPPRRPPPPP", "PFPPPRPPPPFP", "PPMPPPPPPFPP", "PPMMPPPPPPPP"
]);
assert(L.findTile(map, L.T.CASTLE_P)[0] === 1, "玩家城池位置正確");
assert(L.findTile(map, L.T.CASTLE_E)[0] === 10, "敵方城池位置正確");

// ===== 移動範圍 =====
const inf = L.makeUnit("shu", "player", { general: "張飛", type: "infantry" }, 2, 5);
const tiles = L.reachableTiles(map, [inf], inf);
assert(tiles.length > 0, "步兵有可移動格");
assert(tiles.every(t => map[t.y][t.x] !== L.T.MOUNTAIN), "移動範圍不含山地");
assert(tiles.every(t => Math.abs(t.x - 2) + Math.abs(t.y - 5) <= 3), "步兵移動不超過 MOV 3");

// ===== 傷害公式 =====
const atkU = L.makeUnit("shu", "player", { general: "張飛", type: "infantry", atkMod: 2, defMod: 2 }, 2, 5);
const defU = L.makeUnit("wu", "enemy", { general: "呂蒙", type: "infantry", defMod: 2 }, 3, 5);
const noLuck = () => 0.99;  // 不迴避、不暴擊
let r = L.computeDamage(atkU, defU, map, noLuck);
assert(r.dmg === 32 - 20, "基本傷害 = ATK - DEF（平原）");
// 樹林防禦加成（守方喺 (1,3) 樹林，def +2）
const defForest = L.makeUnit("wu", "enemy", { general: "呂蒙", type: "infantry", defMod: 2 }, 1, 3);
r = L.computeDamage(atkU, defForest, map, noLuck);
assert(r.dmg === 32 - 22, "樹林守方傷害減 2");
// 樹林迴避：rand 回傳 0 → 0 < 15 必定 MISS
r = L.computeDamage(atkU, defForest, map, () => 0);
assert(r.miss === true, "樹林 15% 迴避觸發 MISS");
// 暴擊：迴避失敗但暴擊成功（rand 順序：evade check, crit check）
let calls = 0;
r = L.computeDamage(atkU, defU, map, () => (++calls === 1 ? 0.99 : 0.05));
assert(r.crit === true && r.dmg === Math.round((32 - 20) * 1.5), "暴擊傷害 x1.5");
// 武聖：HP < 50% 攻擊 +30%
const guanyu = L.makeUnit("shu", "player", { general: "關羽", type: "infantry", ability: "武聖", atkMod: 4 }, 2, 5);
guanyu.hp = 40;
r = L.computeDamage(guanyu, defU, map, noLuck);
assert(r.dmg === Math.max(1, Math.round(34 * 1.3 - 20)), "武聖 HP<50% 攻擊 +30%");
// 弱化 debuff -30%
const weakened = L.makeUnit("shu", "player", { general: "張飛", type: "infantry", atkMod: 2, defMod: 2 }, 2, 5);
weakened.atkDebuff = 2;
r = L.computeDamage(weakened, defU, map, noLuck);
assert(r.dmg === Math.max(1, Math.round(32 * 0.7 - 20)), "弱化攻擊 -30%");
// 最低傷害 1
const weakArcher = L.makeUnit("shu", "player", { general: "黃忠", type: "archer", ability: "烈弓" }, 2, 5);
weakArcher.atk = 5;
const tank = L.makeUnit("wu", "enemy", { general: "呂蒙", type: "infantry", defMod: 2 }, 3, 5);
r = L.computeDamage(weakArcher, tank, map, noLuck);
assert(r.dmg === 1, "最低傷害為 1");

// ===== 射程 =====
assert(L.effectiveRng(weakArcher) === 4, "烈弓未移動射程加倍");
weakArcher.moved = true;
assert(L.effectiveRng(weakArcher) === 2, "烈弓移動後恢復原射程");
const strat = L.makeUnit("wu", "enemy", { general: "周瑜", type: "strategist", ability: "火攻" }, 4, 5);
assert(L.targetsInRange([strat, atkU], strat, 4, 5).length === 0, "軍師無直接攻擊");

// ===== 出兵點 =====
const occ = new Set();
const spawns = L.spawnPositions(map, 1, 5, 5, occ);
assert(spawns.length === 5, "城池旁產生 5 個出兵點");
assert(new Set(spawns.map(s => s.x + "," + s.y)).size === 5, "出兵點無重疊");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
