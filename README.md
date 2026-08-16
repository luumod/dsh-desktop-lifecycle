# dsh-desktop-lifecycle [![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

为 Windows 上的 DeepSeek Harness Desktop 与 Web 提供“关闭程序”和“重启程序”控制项。控件位于“设置 → 通用设置”底部。

## 安装

在目标 Profile 中安装本地目录或 GitHub 仓库：

```powershell
# 本地开发目录
pnpm dsh plugin --profile web add F:\AI_chat\deepseek\dsh-desktop-lifecycle

# GitHub 仓库
pnpm dsh plugin --profile web add github:luumod/dsh-desktop-lifecycle
```

安装后重启对应的 DSH Host；客户端变更还需要刷新页面。

## 行为与边界

仅在 Windows 上生效。

- **Desktop**（`DSH_DESKTOP=1`）：Host 通过 WMI 创建不属于 Desktop/Host 进程树且没有可见窗口的 PowerShell 辅助进程；辅助进程结束 Desktop 主进程及其后代，重启时随后明确启动原始 Desktop 可执行文件。
- **Web**（`pnpm dsh web` 等）：关闭会退出当前 `dsh web` Host 进程；重启会先以当前 Node 可执行文件和原始参数启动替代 Host，再退出当前进程。

这是进程级操作，不执行 Desktop 壳的优雅 Host 清理流程，会中断正在运行的 Agent、Job 和终端任务。每次操作都会在客户端弹出确认框。

Host 仅接受 loopback authority 上的同源 POST。辅助进程在终止 Desktop 前还会核验 Desktop 主进程的 PID、可执行文件和命令行身份。
