import { useState } from 'react'
import { IconGamepad, IconLock, IconRefresh } from './Icon.jsx'

/**
 * 未连接状态的醒目引导
 * - 客户端没开 → 三步引导 + 刷新按钮
 * - 需要管理员权限 → 额外给「以管理员身份重启」
 */
export default function NotConnected({ status, onRefresh, onElevate, busy, hint }) {
  const [localBusy, setLocalBusy] = useState(false)
  const needsElevation = !!(status && status.needsElevation)
  const isBusy = busy || localBusy

  const doRefresh = async () => {
    setLocalBusy(true)
    try {
      if (onRefresh) await onRefresh()
    } finally {
      setLocalBusy(false)
    }
  }

  return (
    <div className="nc-wrap">
      <div className="nc-card">
        <div className="nc-icon">{needsElevation ? <IconLock size={46} /> : <IconGamepad size={46} />}</div>

        <h2 className="nc-title">
          {needsElevation ? '需要管理员权限才能读取客户端凭据' : '未检测到英雄联盟客户端'}
        </h2>

        <p className="nc-desc">
          {needsElevation
            ? '国服客户端的凭据只存在于进程启动参数里，读取它需要管理员权限。点下面的按钮重启应用即可。'
            : hint || '请先启动英雄联盟客户端并登录到大厅，然后点下面的刷新按钮。'}
        </p>

        {!needsElevation ? (
          <ol className="nc-steps">
            <li>
              <span className="nc-step-num">1</span>
              启动英雄联盟客户端（从 WeGame 或桌面快捷方式启动，**不要**直接点 LeagueClient.exe）
            </li>
            <li>
              <span className="nc-step-num">2</span>
              登录账号，停在**大厅界面**（选人、对局中也可以）
            </li>
            <li>
              <span className="nc-step-num">3</span>
              回到这里点「刷新」
            </li>
          </ol>
        ) : null}

        <div className="nc-actions">
          {needsElevation && onElevate ? (
            <button className="btn primary nc-btn" onClick={onElevate}>
              以管理员身份重启
            </button>
          ) : (
            <button className="btn primary nc-btn" onClick={doRefresh} disabled={isBusy}>
              {isBusy ? <span className="spin" /> : <IconRefresh size={15} />} 刷新连接
            </button>
          )}
        </div>

        {status && status.reason && !needsElevation ? (
          <div className="nc-detail">{status.reason}</div>
        ) : null}
      </div>
    </div>
  )
}
