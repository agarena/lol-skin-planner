import { tileUrl } from '../lib.js'

/**
 * 皮肤小卡（横版小卡）—— 全局唯一模板
 *
 * 定义见 DESIGN.md：只用在「常玩英雄」这类需要一行塞多个的场景。
 * 固定 4 个区域：
 *   ① 16:9 图  ② 右上丝带（已拥有/未拥有）  ③ 左下活动标签（仅未拥有）  ④ 图下方皮肤名
 *
 * 不显示：价格、稀有度、推荐值、等级、炫彩 —— 那些属于「皮肤卡片」。
 * 所有视觉元素必须在本组件内部，页面层不得再叠加边框、丝带、标签或遮罩。
 *
 * @param {object}  skin     { id, name, tilePath, splashPath, owned, limitedTime, discountPct }
 * @param {boolean} clickable 可点（默认否）
 * @param {function} onClick
 */
export default function SkinMiniCard({ skin: s, clickable = false, onClick }) {
  if (!s) return null

  const promo = (() => {
    const parts = []
    if (s.limitedTime) parts.push('限时销售')
    if (s.discountPct > 0) parts.push('-' + s.discountPct + '%')
    return parts.length ? parts.join(' ') : null
  })()

  return (
    <div
      className={'mini-skin ' + (s.owned ? 'owned' : 'missing') + (clickable ? ' clickable' : '')}
      onClick={clickable ? onClick : undefined}
      title={s.name}
    >
      <div className="mini-skin-media">
        <img className="mini-skin-img" src={tileUrl(s.splashPath || s.tilePath)} alt="" loading="lazy" />
        <span className="mini-skin-ribbon">{s.owned ? '已拥有' : '未拥有'}</span>
        {!s.owned && promo ? <span className="mini-skin-promo">{promo}</span> : null}
      </div>
      <div className="mini-skin-name">{s.name}</div>
    </div>
  )
}
