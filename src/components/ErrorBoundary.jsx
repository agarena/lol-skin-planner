import { Component } from 'react'

/**
 * 错误边界：任何渲染异常都显示可读信息，而不是整页黑屏
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, stack: null }
  }

  static getDerivedStateFromError(error) {
    return { error: error && error.message ? error.message : String(error) }
  }

  componentDidCatch(error, info) {
    this.setState({ stack: (info && info.componentStack) || '' })
    // 同时打印到控制台，方便 DevTools 排查
    console.error('[UI ErrorBoundary]', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="eb-wrap">
          <div className="eb-card">
            <div className="eb-icon">!</div>
            <div className="eb-title">界面出错了</div>
            <div className="eb-msg">{this.state.error}</div>
            <div className="eb-actions">
              <button className="btn" onClick={() => { this.setState({ error: null, stack: null }); location.reload() }}>
                重新加载
              </button>
              <button className="btn primary" onClick={() => this.setState({ error: null, stack: null })}>
                忽略，继续用
              </button>
            </div>
            {this.state.stack ? (
              <details className="eb-details">
                <summary>技术细节</summary>
                <pre>{this.state.stack}</pre>
              </details>
            ) : null}
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
