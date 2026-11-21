import { useEffect } from 'react'
import SkinCard from './SkinCard.jsx'
import { IconX } from './Icon.jsx'
import { toSkinCardSkin } from '../lib/skinCardData.js'

/**
 * 英雄皮肤浮层：点卡片弹出，列出该英雄全部皮肤
 * 展示方式：统一用「皮肤卡片」，一行 3 个（见 DESIGN.md）
 * 关闭方式：× 按钮 / 点遮罩 / Esc
 */
export default function ChampSkinPopover({ champion, priceBySkinId, champInfoMap, chromaMap, onClose, onPickSkin, ctxMap, onScore }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!champion) return null

  const skins = (champion.skins || [])
    .filter((s) => !s.isBase)
    .slice()
    .sort((a, b) => (b.rarityRank || 0) - (a.rarityRank || 0) || String(a.name).localeCompare(String(b.name), 'zh'))

  const owned = skins.filter((s) => s.owned).length
  const skinTotal = skins.length

  return (
    <>
      <div
        className="popover-mask"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose()
        }}
      />
      <div className="champ-pop-wide" role="dialog" aria-label={`${champion.name} 的皮肤`}>
        <div className="champ-pop-head">
          <div className="champ-pop-title">
            {champion.name}
            <span className="champ-pop-count">
              拥有 {owned} / {skinTotal}
            </span>
          </div>
          <button className="icon-btn" onClick={onClose} title="关闭（Esc）">
            <IconX size={14} />
          </button>
        </div>

        <div className="champ-pop-grid">
          {skins.map((s) => {
            const p = priceBySkinId && priceBySkinId[s.id]
            const cm = chromaMap && chromaMap[s.id]
            const ci = champInfoMap && champInfoMap[champion.id]
            // 与皮肤页完全同一份卡片数据：商城字段覆盖藏品字段
            const skin = {
              ...toSkinCardSkin(s, p),
              championName: champion.name,
              championId: champion.id,
            }
            return (
              <SkinCard
                key={s.id}
                skin={skin}
                champInfo={
                  ci || {
                    name: champion.name,
                    skinOwned: owned,
                    skinTotal,
                    hasSkin: owned > 0,
                  }
                }
                chromaInfo={cm || (ctxMap && ctxMap.byChroma && ctxMap.byChroma[s.id]) || {}}
                ctxMap={ctxMap}
                onOpenChamp={() => {}}
                onScore={onScore || ((sk) => onPickSkin && onPickSkin(sk))}
              />
            )
          })}
        </div>
      </div>
    </>
  )
}