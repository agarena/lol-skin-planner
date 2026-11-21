import { useEffect, useState } from 'react'
import { scoreOf } from '../lib/score.js'

/** 推荐值明细弹层：点皮肤卡片上的分数或问号打开 */
export default function ScorePopover({ skin, ctx, onClose }) {
  const [sc, setSc] = useState(null)

  useEffect(() => {
    if (!skin) return
    setSc(scoreOf(skin, ctx || {}))
  }, [skin, ctx])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!skin || !sc) return null

  return (
    <div className="sp-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="sp-panel" onClick={(e) => e.stopPropagation()}>
        <div className="sp-head">
          <span className="sp-name">{skin.name || skin.skinName}</span>
          <span className="sp-total">{sc.total} 分</span>
        </div>
        <div className="sp-body">
          {sc.parts.map((p) => (
            <div key={p.key} className={'sp-row' + (Math.round(p.val) === 0 ? ' zero' : '')}>
              <span className="sp-k">{p.key}</span>
              <span className="sp-note">{p.note}</span>
              <span className={'sp-v ' + (p.val > 0 ? 'plus' : p.val < 0 ? 'minus' : '')}>
                {p.val > 0 ? '+' : ''}
                {Math.round(p.val * 10) / 10}
              </span>
            </div>
          ))}
        </div>
        <div className="sp-foot">
          <span className="sp-hint">稀有度已扣除该英雄已有皮肤的价值</span>
          <button className="btn" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
