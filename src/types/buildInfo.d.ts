// 构建期由 electron.vite.config.ts 的 define 注入的全局常量（渲染端 + 主进程通用）。
// 用于「关于」页 + 主进程启动日志显示构建标识，帮用户确认正在运行的包是否为最新源码构建。
declare const __GIT_HASH__: string;
declare const __BUILD_TIME__: string;
declare const __APP_VERSION__: string;
