import { IconRefresh } from './Icon.jsx'

/**
 * 全屏居中的加载态：明确告诉用户「在读取」而不是「卡住了」
 */
export default function LoadingState({ title = '正在读取数据', hint, onRetry }) {
  return (
    <div className="ls-wrap">
      <div className="ls-card">
        <div className="ls-spinner" aria-hidden="true">
          <svg viewBox="0 0 50 50" width="46" height="46">
            <circle cx="25" cy="25" r="20" fill="none" stroke="currentColor" strokeWidth="4" strokeOpacity="0.15" />
            <circle
              cx="25"
              cy="25"
              r="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray="32 94"
            />
          </svg>
        </div>
        <div className="ls-title">{title}</div>
        {hint ? <div className="ls-hint">{hint}</div> : null}
        {onRetry ? (
          <button className="ls-retry" onClick={onRetry}>
            <IconRefresh size={14} /> 重试
          </button>
        ) : null}
      </div>
    </div>
  )
}
