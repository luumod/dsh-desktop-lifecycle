window.__ModuleLoader__.load({
  id: 'dsh-desktop-lifecycle',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')

    const css = `
[data-desktop-lifecycle-row] {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 0;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}
[data-desktop-lifecycle-title] {
  flex: 1;
  min-width: 0;
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
  line-height: 22px;
}
[data-desktop-lifecycle-actions] {
  display: flex;
  align-items: center;
  gap: 8px;
}
[data-desktop-lifecycle-button] {
  height: 36px;
  padding: 0 16px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 18px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  font: inherit;
  font-size: 14px;
  line-height: 22px;
}
[data-desktop-lifecycle-button]:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}
[data-desktop-lifecycle-button]:disabled {
  cursor: default;
  opacity: .55;
}
[data-desktop-lifecycle-error] {
  color: var(--dsw-alias-state-error-primary);
  font-size: 12px;
  line-height: 18px;
}
`

    function insertStyles() {
      const id = 'dsh-desktop-lifecycle/styles'
      if (document.querySelector(`style[data-plugin-css="${id}"]`) !== null) return
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-desktop-lifecycle'
      tag.dataset.pluginCss = id
      tag.textContent = css
      document.head.appendChild(tag)
    }

    function LifecycleRow() {
      const [busy, setBusy] = React.useState(null)
      const [error, setError] = React.useState(null)

      const run = async (action) => {
        const restarting = action === 'restart'
        const confirmed = window.confirm(
          restarting
            ? '重启程序会立即中断正在运行的 Agent、Job 和终端任务。确定重启 DeepSeek Harness 吗？'
            : '关闭程序会立即中断正在运行的 Agent、Job 和终端任务。确定关闭 DeepSeek Harness 吗？',
        )
        if (!confirmed) return

        setBusy(action)
        setError(null)
        try {
          const response = await fetch(`/desktop-lifecycle/v1/action?action=${action}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
          })
          // 生命周期操作会主动终止承载 HTTP 服务的进程；响应可能在传输中断前已经
          // 成功被服务端接受。因此不能无条件调用 response.json() 解析空响应。
          const text = await response.text()
          let result
          if (text !== '') {
            try {
              result = JSON.parse(text)
            } catch {
              throw new Error('服务器返回了无效的操作结果')
            }
          }
          if (!response.ok || result?.ok !== true) {
            throw new Error(result?.error || '操作失败')
          }
        } catch (cause) {
          setBusy(null)
          setError(cause instanceof Error ? cause.message : '操作失败')
        }
      }

      return React.createElement(
        'div',
        { 'data-desktop-lifecycle-row': '' },
        React.createElement('div', { 'data-desktop-lifecycle-title': '' }, '程序'),
        error === null
          ? null
          : React.createElement('div', { role: 'alert', 'data-desktop-lifecycle-error': '' }, error),
        React.createElement(
          'div',
          { 'data-desktop-lifecycle-actions': '' },
          React.createElement(
            'button',
            {
              type: 'button',
              disabled: busy !== null,
              'data-desktop-lifecycle-button': '',
              onClick: () => run('close'),
            },
            busy === 'close' ? '正在关闭…' : '关闭程序',
          ),
          React.createElement(
            'button',
            {
              type: 'button',
              disabled: busy !== null,
              'data-desktop-lifecycle-button': '',
              onClick: () => run('restart'),
            },
            busy === 'restart' ? '正在重启…' : '重启程序',
          ),
        ),
      )
    }

    const inject = ['slots']
    function apply(ctx) {
      insertStyles()
      ctx.slots.inject('settings.general.item', () => ctx.slots.register({
        name: 'settings.general.item',
        id: 'desktop-lifecycle',
        order: 1000,
      }, LifecycleRow))
    }

    exports.inject = inject
    exports.apply = apply
    return module.exports
  },
})
