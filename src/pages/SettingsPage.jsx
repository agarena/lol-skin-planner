import { useState } from 'react'
import { fmtRp } from '../lib.js'

export default function SettingsPage({
  info,
  catalogInfo,
  probe,
  priceMode,
  setPriceMode,
  onProbe,
  onRefreshCatalog,
  onClearCatalog,
  onReconnect,
  connected,
  busy,
}) {
  return (
    <div className="pane">
      <div style={{ maxWidth: 860, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* 连接 */}
        <div className="card">
          <h3>客户端连接</h3>
          <div className="row" style={{ gap: 10 }}>
            <span className={'dot ' + (connected ? 'on' : 'off')} />
            <span>{connected ? '已连接（本地 LCU）' : '未检测到客户端'}</span>
            <div className="spacer" />
            <button className="btn" onClick={onReconnect} disabled={busy}>
              重新探测
            </button>
          </div>
          <div className="hint" style={{ marginTop: 8 }}>
            自动扫描各盘符常见安装目录的 lockfile，兜底读进程命令行，适配 WeGame 国服与官方国际服。
            启动顺序：先开客户端登录到大厅，再开本工具。
          </div>
        </div>

        {/* 商城价格（可选模块） */}
        <div className="card">
          <h3>商城价格（可选）</h3>
          <div className="row">
            <label className="switch">
              <input type="checkbox" checked={priceMode} onChange={(e) => setPriceMode(e.target.checked)} />
              <span className="track" />
            </label>
            <span>{priceMode ? '已开启：尝试读取在售价与限时折扣' : '已关闭：只按等级与拥有情况排序'}</span>
            <div className="spacer" />
            <button className="btn" onClick={onProbe} disabled={busy || !connected}>
              {busy === 'probe' ? <span className="spin" /> : '探测'} 商城接口
            </button>
          </div>

          {probe ? (
            <>
              <div className="hint" style={{ marginTop: 10, color: probe.available ? 'var(--green)' : 'var(--gold)' }}>
                {probe.note}
              </div>
              <table className="status-table" style={{ marginTop: 8 }}>
                <thead>
                  <tr>
                    <th>接口</th>
                    <th>路径</th>
                    <th>状态</th>
                    <th>条数</th>
                  </tr>
                </thead>
                <tbody>
                  {probe.endpoints.map((e) => (
                    <tr key={e.key}>
                      <td>{e.label}</td>
                      <td className="mono dim" style={{ fontSize: 11.5 }}>
                        {e.path}
                      </td>
                      <td className={e.ok ? 'ok' : 'bad'}>{e.status || 'ERR'}</td>
                      <td className="muted">{e.count ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <div className="hint" style={{ marginTop: 10 }}>
              点「探测」看本区服的商城接口是否返回数据。国服部分区服该接口由运营后端接管，返回空是正常现象，
              关掉开关即可，推荐逻辑不受影响。
            </div>
          )}
        </div>

        {/* 元数据 */}
        <div className="card">
          <h3>皮肤元数据</h3>
          <div className="kv">
            <span className="k">来源</span>
            <span className="v">
              {catalogInfo?.source === 'lcu-game-data' ? '客户端内置 lol-game-data（离线可用）' : catalogInfo?.source || '未加载'}
            </span>
            <span className="k">皮肤条目</span>
            <span className="v">{catalogInfo?.skinCount ?? '—'}</span>
            <span className="k">英雄条目</span>
            <span className="v">{catalogInfo?.championCount ?? '—'}</span>
            <span className="k">更新时间</span>
            <span className="v">
              {catalogInfo?.fetchedAt ? new Date(catalogInfo.fetchedAt).toLocaleString('zh-CN') : '—'}
            </span>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn" onClick={() => onRefreshCatalog(true)} disabled={!connected || !!busy}>
              重新拉取
            </button>
            <button className="btn ghost" onClick={onClearCatalog}>
              清空缓存
            </button>
          </div>
          <div className="hint" style={{ marginTop: 8 }}>
            等级（稀有度）、中文名、系列、绝版标记都来自这里；6 小时自动过期重拉。
          </div>
        </div>

        {/* 说明 */}
        <div className="card">
          <h3>说明</h3>
          <div className="hint">
            · 全部数据来自本机客户端 LCU 的只读接口，不注入、不修改客户端文件、不代付下单。
            <br />
            · 价格与折扣属于可选模块：拿到就显示，拿不到自动降级为纯优先级排序。
            <br />
            · 战利品里的皮肤碎片不计入「已拥有」，避免误判。
          </div>
          {info ? (
            <div className="kv small" style={{ marginTop: 12 }}>
              <span className="k">版本</span>
              <span className="v">{info.version}</span>
              <span className="k">Electron</span>
              <span className="v">{info.electron}</span>
              <span className="k">数据目录</span>
              <span className="v mono" style={{ fontSize: 11.5 }}>
                {info.userData}
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
