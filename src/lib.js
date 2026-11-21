export const RARITY_CLASS = {
  kNoRarity: 'rb-none',
  '': 'rb-none',
  kRare: 'rb-rare',
  kEpic: 'rb-epic',
  kLegendary: 'rb-leg',
  kUltimate: 'rb-ult',
  kMythic: 'rb-myth',
  kExalted: 'rb-exalt',
  kTranscendent: 'rb-trans',
}

export const RARITY_HEX = {
  kNoRarity: '#8b98a8',
  '': '#8b98a8',
  kRare: '#4aa3df',
  kEpic: '#a371f7',
  kLegendary: '#e3b341',
  kUltimate: '#ff7b72',
  kMythic: '#f778ba',
  kExalted: '#79c0ff',
  kTranscendent: '#f0e6d2',
}

export function rarityClass(rarity) {
  return RARITY_CLASS[rarity] || 'rb-none'
}

export function rarityHex(rarity) {
  return RARITY_HEX[rarity] || '#8b98a8'
}

/** 皮肤贴图：走 lcu:// 代理客户端内置资源，离线可用 */
export function tileUrl(tilePath) {
  if (!tilePath) return ''
  const p = tilePath.replace(/^\/+/, '')
  return 'lcu://' + encodeURI(p)
}

/** 英雄方形头像：客户端内置图标 */
export function championIconUrl(championId) {
  return `lcu://lol-game-data/assets/v1/champion-icons/${championId}.png`
}

export function fmtRp(n) {
  if (n == null) return '—'
  return Number(n).toLocaleString('zh-CN')
}

export const TIER_META = {
  S: { label: '零皮肤英雄', sub: '该英雄一件皮肤都没有 —— 最该补' },
  A: { label: '等级升级', sub: '比你现在最高的那件更高一档' },
  B: { label: '同档折扣', sub: '和你最高档同级，但当前折扣大' },
  C: { label: '同档收藏', sub: '同级，收藏向' },
  D: { label: '低于现有', sub: '不高于你已有的最高档' },
  skip: { label: '已拥有', sub: '清单里这些你已经有了' },
}

export const TIER_FLOW = ['S', 'A', 'B', 'C', 'D', 'skip']

/** 英雄定位（与客户端商城筛选一致） */
export const ROLE_LABELS = {
  assassin: '刺客',
  fighter: '战士',
  tank: '坦克',
  mage: '法师',
  marksman: '射手',
  support: '辅助',
}

export const ROLE_ORDER = ['assassin', 'fighter', 'tank', 'mage', 'marksman', 'support']

export function roleLabel(role) {
  return ROLE_LABELS[role] || role
}
