/**
 * 开发/演示用假数据（?mock=1 时启用）
 * 只用于验证界面布局，不参与真实逻辑。
 */
const C = (id, name, alias) => ({ id, name, alias })

function skin(id, name, rarity, rarityLabel, rarityRank, owned, extra = {}) {
  return {
    id,
    name,
    rawName: name,
    isBase: false,
    owned,
    rarity,
    rarityLabel,
    rarityRank,
    legacy: false,
    lines: [],
    tilePath: '',
    splashPath: '',
    chromas: 0,
    ...extra,
  }
}

function champ(id, name, alias, owned, skins) {
  const nb = skins.filter((s) => !s.isBase)
  const own = nb.filter((s) => s.owned)
  const max = own.reduce((m, s) => Math.max(m, s.rarityRank), 0)
  const top = own.filter((s) => s.rarityRank === max)[0]
  return {
    ...C(id, name, alias),
    owned,
    freeToPlay: false,
    skins: [{ id: id * 1000, name: `${name} 默认`, isBase: true, owned: true, rarity: '', rarityLabel: '普通', rarityRank: 1, tilePath: '' }, ...skins],
    ownedSkinCount: own.length,
    totalSkinCount: nb.length,
    maxOwnedRarityRank: max,
    maxOwnedRarityLabel: top ? top.rarityLabel : '',
  }
}

export const mockCollection = {
  summoner: { gameName: '测试召唤师', tagLine: '0823', rp: 12800, level: 214, summonerId: 1 },
  champions: [
    champ(103, '九尾妖狐', 'Ahri', true, [
      skin(103001, 'K/DA 阿狸', 'kEpic', '史诗', 3, true),
      skin(103002, '灵魂莲华 阿狸', 'kEpic', '史诗', 3, true),
      skin(103003, '星之守护者 阿狸', 'kLegendary', '传说', 4, false),
      skin(103004, '魅惑女巫 阿狸', 'kEpic', '史诗', 3, false),
    ]),
    champ(157, '疾风剑豪', 'Yasuo', true, [
      skin(157001, '西部魔影 亚索', 'kLegendary', '传说', 4, true),
      skin(157002, '灵魂莲华 亚索', 'kEpic', '史诗', 3, true),
      skin(157003, '夜使者 亚索', 'kLegendary', '传说', 4, false),
      skin(157004, '真实伤害 亚索', 'kEpic', '史诗', 3, false),
    ]),
    champ(99, '光辉女郎', 'Lux', true, [
      skin(99001, '战斗学院 拉克丝', 'kEpic', '史诗', 3, true),
      skin(99002, '大元素使 拉克丝', 'kUltimate', '终极', 6, false),
      skin(99003, '星之守护者 拉克丝', 'kLegendary', '传说', 4, false),
    ]),
    champ(11, '无极剑圣', 'MasterYi', true, [
      skin(11001, '源计划：林 易', 'kLegendary', '传说', 4, false),
      skin(11002, '武术大师 易', 'kEpic', '史诗', 3, false),
    ]),
    champ(41, '酒桶', 'Gangplank', true, [
      skin(41001, '泳池派对 古拉加斯', 'kEpic', '史诗', 3, false),
      skin(41002, '雪装 古拉加斯', 'kNoRarity', '普通', 1, false),
    ]),
    champ(86, '德玛西亚之力', 'Garen', true, [
      skin(86001, '神王 盖伦', 'kLegendary', '传说', 4, true),
      skin(86002, '德玛西亚警官 盖伦', 'kEpic', '史诗', 3, true),
    ]),
    champ(92, '放逐之刃', 'Riven', true, [
      skin(92001, '黎明使者 锐雯', 'kLegendary', '传说', 4, true),
      skin(92002, '玉剑传说 锐雯', 'kMythic', '神话', 5, false),
    ]),
    champ(67, '暗夜猎手', 'Vayne', true, [
      skin(67001, '光明哨兵 薇恩', 'kLegendary', '传说', 4, true),
      skin(67002, '摄魂使者 薇恩', 'kMythic', '神话', 5, false),
    ]),
    champ(238, '影流之主', 'Zed', true, []),
    champ(64, '盲僧', 'LeeSin', true, [skin(64001, '龙的传人 李青', 'kLegendary', '传说', 4, true)]),
  ],
  loot: [],
  stats: {
    championOwned: 148,
    championTotal: 168,
    skinOwned: 87,
    skinTotal: 2008,
    catalogSource: 'mock',
    catalogSkins: 2008,
    fetchedAt: Date.now(),
  },
}

const P = (rp, off, end) => ({
  rp,
  originalRp: off ? Math.round(rp / (1 - off / 100)) : rp,
  discountPct: off || 0,
  onSale: !!off,
  saleEnd: end || null,
  currency: 'RP',
})

/** 商城条目：把 mock 藏品展开成皮肤页可用的列表 */
export const mockStoreItems = (() => {
  const items = []
  const lines = ['星之守护者', '源计划', '灵魂莲华', '西部魔影', '战斗学院']
  let i = 0
  for (const c of mockCollection.champions) {
    for (const s of c.skins || []) {
      if (s.isBase) continue
      const rank = s.rarityRank || 1
      const base = rank * 1000 + 450
      const off = i % 3 === 0 ? 50 : i % 5 === 0 ? 30 : 0
      const p = P(base, off, off ? '2026-11-28T20:00:00+08:00' : null)
      items.push({
        ...p,
        skinId: s.id,
        skinName: s.name,
        name: s.name,
        championId: c.id,
        championName: c.name,
        championOwned: !!c.owned,
        rarity: s.rarity,
        rarityLabel: s.rarityLabel,
        rarityRank: rank,
        legacy: i % 11 === 0,
        lines: [lines[i % lines.length]],
        tilePath: '',
        splashPath: '',
        owned: !!s.owned,
        state: s.owned ? 'owned' : 'none',
        inStore: true,
        purchasable: true,
        featured: i < 4,
        limitedTime: i % 7 === 0,
        mythicSale: rank >= 5 ? { price: 500, originalPrice: 1000, discountPct: 50 } : null,
        releaseLabel: '2024-0' + ((i % 9) + 1),
        releaseDate: Date.parse('2024-0' + ((i % 9) + 1) + '-01'),
      })
      i += 1
    }
  }
  return { items, fetchedAt: Date.now(), counts: { all: items.length } }
})()

/** mock 方案：内存存储，刷新页面即重置 */
let mockPlans = []
let mockPlanSeq = 1

const MOCK_SKIN_INDEX = (() => {
  const m = new Map()
  for (const c of mockCollection.champions) {
    for (const s of c.skins || []) {
      if (s.isBase) continue
      m.set(s.id, { c, s })
    }
  }
  return m
})()

const mkItem = (champId, champName, skinId, skinName, rarity, label, rank, tier, reason, price, owned) => ({
  skinId,
  skinName,
  championId: champId,
  championName: champName,
  championOwned: true,
  rarity,
  rarityLabel: label,
  rarityRank: rank,
  legacy: false,
  lines: [],
  tilePath: '',
  owned: !!owned,
  ownedSkinCount: 0,
  maxOwnedRarityLabel: '史诗',
  maxOwnedRarityRank: 3,
  price: price || null,
  tier,
  tierLabel: '',
  reason,
  suggestion: '',
})

export const mockAnalysis = (() => {
  const items = [
    mkItem(11, '无极剑圣', 11001, '源计划：林 易', 'kLegendary', '传说', 4, 'S', '无极剑圣 目前一件皮肤都没有，这件直接补齐空缺', P(4950, 50, '2026-11-26')),
    mkItem(41, '酒桶', 41001, '泳池派对 古拉加斯', 'kEpic', '史诗', 3, 'S', '酒桶 目前一件皮肤都没有，这件直接补齐空缺', P(3450, 50, '2026-11-26')),
    mkItem(103, '九尾妖狐', 103003, '星之守护者 阿狸', 'kLegendary', '传说', 4, 'A', '传说 > 你现有最高档 史诗，属于明显升级', P(4950, 50, '2026-11-26')),
    mkItem(99, '光辉女郎', 99002, '大元素使 拉克丝', 'kUltimate', '终极', 6, 'A', '终极 > 你现有最高档 史诗，属于明显升级', P(9950, 50, '2026-11-26')),
    mkItem(92, '放逐之刃', 92002, '玉剑传说 锐雯', 'kMythic', '神话', 5, 'A', '神话 > 你现有最高档 传说，属于明显升级', null),
    mkItem(67, '暗夜猎手', 67002, '摄魂使者 薇恩', 'kMythic', '神话', 5, 'A', '神话 > 你现有最高档 传说，属于明显升级', null),
    mkItem(157, '疾风剑豪', 157003, '夜使者 亚索', 'kLegendary', '传说', 4, 'B', '与你最高档同为 传说，但当前折扣 45%', P(5450, 45, '2026-11-24')),
    mkItem(99, '光辉女郎', 99003, '星之守护者 拉克丝', 'kLegendary', '传说', 4, 'C', '与你已有最高档（史诗）同级，属于收藏向', P(4950, 50, '2026-11-26')),
    mkItem(157, '疾风剑豪', 157004, '真实伤害 亚索', 'kEpic', '史诗', 3, 'D', '等级（史诗）低于你已有的 传说，优先级低', P(4450, 35, '2026-11-26')),
    mkItem(103, '九尾妖狐', 103001, 'K/DA 阿狸', 'kEpic', '史诗', 3, 'skip', '这件你已经有，不用重复购买', null, true),
    mkItem(157, '疾风剑豪', 157001, '西部魔影 亚索', 'kLegendary', '传说', 4, 'skip', '这件你已经有，不用重复购买', null, true),
  ]
  const groups = { S: [], A: [], B: [], C: [], D: [], skip: [] }
  for (const it of items) groups[it.tier].push(it)
  return {
    items,
    groups,
    unresolved: [{ raw: '至臻 阿狸 2024', reason: '没有匹配到任何皮肤' }],
    summary: {
      inputLines: 10,
      matched: 11,
      unresolved: 1,
      byTier: { S: 2, A: 4, B: 1, C: 1, D: 1, skip: 2 },
      totalPrice: 38650,
      hasPrice: true,
      championLevel: 7,
    },
    stats: mockCollection.stats,
    summoner: mockCollection.summoner,
  }
})()

export const mockUsage = (() => {
  const raw = [
    { id: 11, m: 9, p: 142300, g: 18, r30: 6, w: 61 },
    { id: 157, m: 12, p: 386400, g: 24, r30: 9, w: 54 },
    { id: 103, m: 8, p: 121800, g: 14, r30: 4, w: 57 },
    { id: 99, m: 7, p: 96200, g: 11, r30: 3, w: 63 },
    { id: 92, m: 6, p: 72400, g: 9, r30: 2, w: 44 },
    { id: 67, m: 11, p: 274500, g: 15, r30: 5, w: 60 },
    { id: 41, m: 4, p: 21800, g: 4, r30: 1, w: 50 },
    { id: 86, m: 5, p: 41200, g: 5, r30: 0, w: 40 },
  ]
  const champions = raw.map((x, i) => ({
    championId: x.id,
    masteryLevel: x.m,
    masteryPoints: x.p,
    games: x.g,
    recent30: x.r30,
    winRate: x.w,
    score: x.m * 18 + x.p / 2500 + x.r30 * 6 + x.g * 2,
    rank: 0,
  }))
  champions.sort((a, b) => b.score - a.score)
  champions.forEach((c, i) => (c.rank = i + 1))
  return {
    available: true,
    masteryAvailable: true,
    champions,
    byChampion: Object.fromEntries(champions.map((c) => [c.championId, c])),
    fetchedAt: Date.now(),
  }
})()

export const mockApi = {
  info: async () => ({ ok: true, data: { version: '0.1.0', electron: '33.x', chrome: '130', userData: 'C:\\mock', dev: true } }),
  status: async () => ({
    ok: true,
    data: {
      connected: true,
      port: 51234,
      source: 'lockfile',
      summoner: { summonerId: 1, gameName: '测试召唤师', tagLine: '0823', level: 214 },
    },
  }),
  collection: async () => ({ ok: true, data: mockCollection }),
  catalogLoad: async () => ({ ok: true, data: { source: 'lcu-game-data', skinCount: 2008, championCount: 168, fetchedAt: Date.now() } }),
  catalogClear: async () => ({ ok: true, data: true }),
  storeProbe: async () => ({
    ok: true,
    data: {
      available: true,
      salesCount: 23,
      catalogCount: 1840,
      probedAt: Date.now(),
      note: '商城接口可用，价格与折扣自动填入',
      endpoints: [
        { key: 'sales', label: '限时折扣清单', path: '/lol-store/v1/catalog/sales', status: 200, count: 23, ok: true },
        { key: 'catalog', label: '皮肤商城目录', path: '/lol-store/v1/catalog?inventoryType=CHAMPION_SKIN', status: 200, count: 1840, ok: true },
        { key: 'storeUrl', label: '商城地址', path: '/lol-store/v1/getStoreUrl', status: 200, count: 1, ok: true },
      ],
    },
  }),
  storePrices: async () => ({ ok: true, data: { prices: {}, sales: [], fetchedAt: Date.now() } }),
  storeItems: async () => ({ ok: true, data: mockStoreItems }),
  storeMythic: async () => ({
    ok: true,
    data: {
      available: true,
      shopDate: '2026-11-20',
      updatedAt: Date.now(),
      expiresAt: Date.now() + 7 * 864e5,
      itemCount: 4,
      attribution: { url: 'https://itemshop.gg', label: '数据来自 itemshop.gg' },
      mythic: {
        total: 4,
        unowned: 3,
        matched: 4,
        sections: [
          {
            title: 'Mythic Shop: 本周轮换',
            isMythic: true,
            endsAt: '2026-11-27',
            items: [
              { name: '至臻 阿狸', englishName: 'Prestige K/DA Ahri', type: '皮肤', amount: 100, currency: 'Mythic Essence', owned: false, matched: true, skinId: 103003, rarityLabel: '神话' },
              { name: '摄魂使者 薇恩', englishName: 'Soulstealer Vayne', type: '皮肤', amount: 100, currency: 'Mythic Essence', owned: false, matched: true, skinId: 67002, rarityLabel: '神话' },
              { name: '玉剑传说 锐雯', englishName: 'Mythmaker Riven', type: '皮肤', amount: 125, currency: 'Mythic Essence', owned: false, matched: true, skinId: 92002, rarityLabel: '神话' },
              { name: 'K/DA 阿狸', englishName: 'K/DA Ahri', type: '皮肤', amount: 100, currency: 'Mythic Essence', owned: true, matched: true, skinId: 103001, rarityLabel: '史诗' },
            ],
          },
        ],
      },
    },
  }),
  skinParse: async (payload) => {
    const text = (payload && payload.text) || ''
    const lines = String(text)
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
    const seen = new Set()
    const items = []
    for (const line of lines) {
      for (const [id, { c, s }] of MOCK_SKIN_INDEX) {
        if (seen.has(id)) continue
        if (line.includes(s.name) || line.includes(c.name)) {
          seen.add(id)
          items.push({
            skinId: id,
            skinName: s.name,
            championId: c.id,
            championName: c.name,
            rarity: s.rarity,
            rarityLabel: s.rarityLabel,
            rarityRank: s.rarityRank,
            tilePath: s.tilePath,
            splashPath: s.splashPath,
            releaseLabel: '2024-06',
            owned: !!s.owned,
          })
        }
      }
    }
    return { ok: true, data: { items, summary: { matched: items.length }, expiresAt: null } }
  },
  analyze: async () => ({ ok: true, data: mockAnalysis }),
  usage: async () => ({ ok: true, data: mockUsage }),
  championStats: async () => ({ ok: true, data: { modes: ['ranked', 'aram'], byChampion: {} } }),
  listPlans: async () => ({ ok: true, data: { plans: mockPlans } }),
  savePlan: async (payload) => {
    const id = (payload && payload.id) || 'mock-' + mockPlanSeq++
    const exist = mockPlans.find((p) => p.id === id)
    if (exist) {
      Object.assign(exist, payload, { id, updatedAt: Date.now() })
      return { ok: true, data: exist }
    }
    const plan = {
      id,
      name: (payload && payload.name) || '2026-11-20 方案' + mockPlanSeq,
      skinIds: (payload && payload.skinIds) || [],
      expiresAt: (payload && payload.expiresAt) || null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    mockPlans = [plan, ...mockPlans]
    return { ok: true, data: plan }
  },
  deletePlan: async (id) => {
    mockPlans = mockPlans.filter((p) => p.id !== id)
    return { ok: true, data: true }
  },
  sharePlan: async (id) => {
    const plan = mockPlans.find((p) => p.id === id)
    if (!plan) return { ok: false, error: '方案不存在' }
    return { ok: true, data: { code: '咕咕MOCK' + id + '嘎嘎', expiresAt: plan.expiresAt || null } }
  },
  importPlan: async (payload) => {
    const code = (payload && payload.code) || ''
    const m = code.match(/MOCK([A-Za-z0-9-]+)/)
    const plan = m && mockPlans.find((p) => p.id === m[1])
    if (!plan) return { ok: false, error: '口令无效' }
    return { ok: true, data: { plan } }
  },
  copyText: async () => ({ ok: true, data: true }),
  openExternal: async () => ({ ok: true, data: true }),
  relaunchElevated: async () => ({ ok: true, data: true }),
}
