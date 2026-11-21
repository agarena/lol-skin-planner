import { useState, useEffect } from 'react'
import { tileUrl } from '../lib.js'

/** 皮肤贴图：为空或加载失败时退回渐变占位，避免破图 */
export default function Thumb({ path, className, style, alt = '' }) {
  const [err, setErr] = useState(!path)
  useEffect(() => {
    setErr(!path)
  }, [path])

  if (err) {
    return (
      <div
        className={className}
        style={{
          display: 'grid',
          placeItems: 'center',
          background: 'linear-gradient(140deg, #1c2734, #0d141c 70%)',
          color: '#33414f',
          fontSize: 15,
          ...style,
        }}
      >
        ◇
      </div>
    )
  }
  return (
    <img
      className={className}
      style={style}
      src={tileUrl(path)}
      alt={alt}
      loading="lazy"
      draggable={false}
      onError={() => setErr(true)}
    />
  )
}
