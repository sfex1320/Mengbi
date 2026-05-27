AutoTrace 便携 exe 放置目录(Phase 2,2026-05-27)
================================================================

把 autotrace.exe(Windows static build,~2 MB)放到这里。
runtime 路径会被识别为:
  - dev:           electron/services/vectorize/engines/autotraceEngine.ts 里的 resolveAutotracePath()
                   会按以下顺序找(优先级从高到低):
                   1) settings 表 vec_autotrace_path 值(用户在 mengbi 设置里填的绝对路径)
                   2) userData/engines/autotrace/autotrace.exe(预留的一键下载安装位置)
                   3) <项目根>/resources/autotrace-portable/autotrace.exe  ← 把 exe 放这
  - packaged:      process.resourcesPath/autotrace-portable/autotrace.exe(electron-builder 自动 copy)

下载来源
--------
官方 GitHub release:
  https://github.com/autotrace/autotrace/releases
找 Windows static build,例如 autotrace-0.31.10-win64.zip(或类似版本)。
解压拿到 autotrace.exe + 若干 DLL(部分 static build 已内置)。

License
-------
AutoTrace 是 GPL-2.0 + AFPL 双许可。打包到商业产品需保留 LICENSE 文件。

放置 exe 之后,mengbi 启动时 ModeSelector 里的 Pro 按钮会自动激活
(由 api:vec:autotrace-probe 探测)。
