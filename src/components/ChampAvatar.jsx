import { useState } from 'react'
import { championIconUrl } from '../lib.js'

/** 英雄头像：加载失败时退回首字方块 */
export default function ChampAvatar({ id, name, size = 40, radius = 7 }) {
  const [err, setErr] = useState(false)
  const style = {
    width: size,
    height: size,
    borderRadius: radius,
    flex: '0 0 auto',
    background: 'linear-gradient(140deg,#1b2634,#0d141d)',
  }
  if (err) {
    return (
      <div style={{ ...style, display: 'grid', placeItems: 'center', color: '#5d6b7d', fontWeight: 700, fontSize: size * 0.4 }}>
        {(name || '?').slice(0, 1)}
      </div>
    )
  }
  return <img src={championIconUrl(id)} alt={name || ''} style={style} draggable={false} onError={() => setErr(true)} />
}
