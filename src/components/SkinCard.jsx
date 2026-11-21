import { rarityClass, rarityHex, tileUrl, fmtRp } from '../lib.js'
import Thumb from './Thumb.jsx'
import { scoreOf } from '../lib/score.js'

/**
 * 皮肤卡片（竖版大卡）—— 全局唯一模板
 *
 * 定义见 DESIGN.md：商城、方案、英雄浮层、确认弹窗，凡「皮肤卡片」都用这个组件。
 * 所有视觉元素必须在本组件内部：根节点边框/圆角/裁剪、背景图、右上丝带/角标、
 * 勾选圈、名称/英雄/标签/价格/特效/推荐值覆盖层。
 * 严禁在页面层再给卡片外加边框、角标、遮罩或任何绝对定位装饰。
 *
 * 固定 7 个区域，任何界面不得增减：
 *   ① 16:9 原画   ② 已拥有丝带 / 折扣角标   ③ 皮肤名称   ④ 英雄名·拥有数·稀有度
 *   ⑤ 状态标签    ⑥ 价格       ⑦ 元信息 + 推荐值
 *
 * @param {object}   skin        皮肤数据（商城条目或藏品皮肤）
 * @param {object}   champInfo   { skinOwned, skinTotal, masteryLevel, maxOwnedRank, maxOwnedLabel, tierRanked, tierAram, hasSkin }
 * @param {object}   chromaInfo  { chromaOwned, chromaTotal, prestigeOwned, prestigeTotal }
 * @param {object}   ctxMap      打分上下文（可选，传了才显示推荐值）
 * @param {function} onOpenChamp 点卡片 → 打开英雄浮层
 * @param {function} onScore     点推荐值 → 打开明细
 * @param {boolean}  selectable  是否显示勾选态（确认弹窗用）
 * @param {boolean}  selected    是否选中
 * @param {function} onToggle    点卡片切换选中
 */
export default function SkinCard({
  skin: x,
  champInfo: ci,
  chromaInfo: cm,
  ctxMap,
  onOpenChamp,
  onScore,
  selectable = false,
  selected = false,
  onToggle,
}) {
  if (!x) return null

  const skinId = x.skinId != null ? x.skinId : x.id
  const name = x.name != null ? x.name : x.skinName
  const championName = x.championName || (ci && ci.name) || ''

  // 推荐值
  const sc =
    ctxMap && !selectable
      ? scoreOf(
          {
            ...x,
            id: skinId,
            rarity: x.rarity,
            price: { originalRp: x.originalRp },
            legacy: x.legacy,
            releaseLabel: x.releaseLabel,
            releaseAt: x.releaseDate,
          },
          {
            ownedByRarity: (ctxMap.byRarity && ctxMap.byRarity[x.championId]) || {},
            chromaOwned: cm ? cm.chromaOwned : 0,
            prestigeOwned: cm ? cm.prestigeOwned : 0,
            champSkinOwned: ci ? ci.skinOwned : 0,
            masteryLevel: ci ? ci.masteryLevel : 0,
          }
        )
      : null

  const handleClick = () => {
    if (selectable) {
      onToggle && onToggle(skinId)
    } else {
      onOpenChamp && onOpenChamp()
    }
  }

  return (
    <div
      className={'skin-card ' + rarityClass(x.rarity) + (x.owned ? ' owned' : '') + (selectable ? ' selectable' : '') + (selected ? ' selected' : '')}
      style={{ '--rarity': rarityHex(x.rarity) }}
      onClick={handleClick}
      title={selectable ? name : `查看 ${championName} 的全部皮肤`}
    >
      <div
        className="skin-card-bg"
        style={{ backgroundImage: `url("${tileUrl(x.splashPath || x.tilePath)}")` }}
      />

      {/* ① 右上角：已拥有 → 绿丝带；未拥有 → 折扣/限时角标 */}
      {x.owned ? (
        <span className="skin-card-ribbon">已拥有</span>
      ) : (
        (() => {
          const parts = []
          if (x.limitedTime) parts.push('限时销售')
          if (x.discountPct > 0) parts.push('-' + x.discountPct + '%')
          if (x.saleEnd) {
            const m = String(x.saleEnd).match(/^(\d{4})-(\d{2})-(\d{2})/)
            if (m) parts.push(m[2] + '-' + m[3] + '结束')
          }
          if (!parts.length) return null
          return <span className="skin-card-flag">{parts.join(' ')}</span>
        })()
      )}

      {/* 勾选态（确认弹窗） */}
      {selectable ? <span className="skin-card-check">{selected ? '✓' : ''}</span> : null}

      <div className="skin-card-overlay">
        {/* ③ 名称 */}
        <div className="skin-card-name" title={name}>
          {name}
        </div>

        {/* ④ 英雄名 · 拥有数 · 稀有度 */}
        <div className="skin-card-meta">
          {ci ? (
            <span className="champ-skin-count">
              {championName} {ci.skinOwned}/{ci.skinTotal}
            </span>
          ) : (
            <span className="champ-skin-count">{championName}</span>
          )}
          <span className={'rb ' + rarityClass(x.rarity)}>{x.rarityLabel || ''}</span>
        </div>

        {/* ⑤ 状态标签 */}
        <div className="skin-card-tags">
          {ci && !ci.hasSkin ? <span className="tag warn">无皮肤</span> : null}
          {ci && ci.tierRanked === 1 ? <span className="tag t1">排位T1</span> : null}
          {ci && ci.tierAram === 1 ? <span className="tag t1">乱斗T1</span> : null}
          {ci && x.rarityRank > ci.maxOwnedRank ? (
            <span className="tag up" title={`该英雄你拥有的最高档是${ci.maxOwnedLabel}`}>
              未拥有高档（当前{ci.maxOwnedLabel}）
            </span>
          ) : null}
        </div>

        {/* ⑥ 价格 */}
        <div className="skin-card-price">
          {x.owned ? (
            <span className="cur green">已拥有</span>
          ) : x.mythicSale ? (
            <>
              <span className="price-now">{x.mythicSale.price}</span>
              <span className="price-old">{x.mythicSale.originalPrice}</span>
              <span className="price-off">-{x.mythicSale.discountPct}%</span>
              <span className="cur">神话精萃</span>
            </>
          ) : x.purchasable ? (
            <>
              <span className="price-now">{fmtRp(x.rp)}</span>
              {x.discountPct > 0 ? (
                <>
                  <span className="price-old">{fmtRp(x.originalRp)}</span>
                  <span className="price-off">-{x.discountPct}%</span>
                </>
              ) : null}
            </>
          ) : (
            <span className="cur purple">非点券直购</span>
          )}
        </div>

        {/* 特效演示：跳 B站搜索 */}
        <div className="skin-card-demo">
          <button
            className="demo-link"
            onClick={(e) => {
              e.stopPropagation()
              const kw = encodeURIComponent((name || '') + ' 皮肤特效')
              window.lol.openExternal('https://search.bilibili.com/all?keyword=' + kw)
            }}
            title={'在 B 站搜索「' + (name || '') + ' 皮肤特效」'}
          >
            特效演示
          </button>
        </div>

        {/* ⑦ 元信息 + 推荐值 */}
        <div className="skin-card-foot">
          <span className="stats-line">
            {ci && ci.masteryLevel ? <span>LV.{ci.masteryLevel}</span> : null}
            {x.releaseLabel ? (
              <span className="rel-date" title={'上线 ' + x.releaseLabel}>
                {String(x.releaseLabel).slice(0, 7)}
              </span>
            ) : null}
            {cm && cm.chromaTotal ? (
              <span title={`炫彩 ${cm.chromaOwned}/${cm.chromaTotal}`}>
                炫{cm.chromaOwned}/{cm.chromaTotal}
              </span>
            ) : null}
            {cm && cm.prestigeTotal ? (
              <span className="gold" title={`臻彩 ${cm.prestigeOwned}/${cm.prestigeTotal}`}>
                臻{cm.prestigeOwned}/{cm.prestigeTotal}
              </span>
            ) : null}
          </span>
          {sc ? (
            <span className="score-chip">
              <button
                className="score-num"
                onClick={(e) => {
                  e.stopPropagation()
                  onScore &&
                    onScore({
                      ...x,
                      id: skinId,
                      price: { originalRp: x.originalRp },
                    })
                }}
                title="查看推荐值明细"
              >
                <span className="score-label">推荐</span>
                {sc.total}
              </button>
            </span>
          ) : null}
        </div>
      </div>
    </div>
  )
}
