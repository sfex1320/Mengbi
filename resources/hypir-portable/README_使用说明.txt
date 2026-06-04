════════════════════════════════════════════════════════════════════════════
  HYPIR Portable Engine — 使用说明
════════════════════════════════════════════════════════════════════════════

【这是什么】
本目录是一个完全自包含的 HYPIR 推理引擎包。主程序（梦笔）不会 import HYPIR 任
何 Python 代码，而是通过本地 HTTP（127.0.0.1:7865）调用本包，所以：
  - 主程序环境干净，不会被 PyTorch / diffusers 污染
  - 本包整体可拷贝迁移到任意 Windows 电脑（含 NVIDIA 显卡 + 驱动）
  - HYPIR 崩了不会拖死主程序

整个包除"runtime\python\"和"models\"两块外，其余文件都已就位。
你只需要做三件事：① 部署便携 Python ② 装依赖 ③ 放模型，下面分步说明。

════════════════════════════════════════════════════════════════════════════
  目录结构
════════════════════════════════════════════════════════════════════════════
HYPIR_Portable/
├── start_hypir.bat              启动服务
├── stop_hypir.bat               停止服务（graceful + 兜底强杀）
├── test_env.bat                 环境自检，落 logs\env_check.txt
├── install_or_repair.bat        装 / 重装依赖
├── README_使用说明.txt           本文件
│
├── runtime/python/              【需自部署】可嵌入版 Python（约 50MB）
│   ├── python.exe
│   ├── Lib/
│   ├── site-packages/
│   └── Scripts/
│
├── app/
│   ├── HYPIR/                   【需自部署】HYPIR 官方源码（git clone）
│   └── hypir_server/            ⭐ HTTP 服务源码（已就位，别动）
│       ├── server.py
│       ├── api.py
│       ├── hypir_adapter.py
│       ├── config.py
│       ├── errors.py
│       └── requirements_locked.txt
│
├── models/                      【需自部署】
│   ├── hypir/HYPIR_sd2.pth      HYPIR 权重
│   └── sd2_1_base/              SD2.1 base diffusers 目录
│
├── cache/                       自动生成；HF / torch 缓存全部锁这里
├── input/  output/  temp/       I/O 工作区
├── logs/                        hypir.log + env_check.txt
└── config/hypir_config.json     端口 / 路径 / 默认参数

════════════════════════════════════════════════════════════════════════════
  第 1 步：部署便携 Python
════════════════════════════════════════════════════════════════════════════
1. 去 https://www.python.org/downloads/windows/ 下 "Windows embeddable
   package (64-bit)"，推荐 3.10.x（HYPIR / diffusers 都过得了）
2. 解压到 HYPIR_Portable\runtime\python\，保证里面有 python.exe
3. 编辑 runtime\python\pythonXX._pth（XX 是版本号，如 310），把这两行确认在：
       import site
       Lib\site-packages
   如果 "import site" 被注释（# import site），把 # 去掉
4. Bootstrap pip：
   - 下 https://bootstrap.pypa.io/get-pip.py 到 runtime\python\
   - 双击命令行进入 runtime\python\，跑：
       python.exe get-pip.py

════════════════════════════════════════════════════════════════════════════
  第 2 步：装依赖
════════════════════════════════════════════════════════════════════════════
双击 install_or_repair.bat。它会自动：
  - 升级 pip / wheel
  - 装 PyTorch CUDA 版（torch==2.3.1+cu121），从 PyTorch 官方索引
  - 装 requirements_locked.txt 列的其它依赖（diffusers / transformers / fastapi / ...）

国内网慢？编辑 install_or_repair.bat，取消 PYPI_INDEX 一行注释切清华源。
PyTorch 的索引 https://download.pytorch.org/whl/cu121 不要换，国内能通。

装完会打印：torch 2.3.1+cu121 cuda True

════════════════════════════════════════════════════════════════════════════
  第 3 步：放模型 + HYPIR 源码
════════════════════════════════════════════════════════════════════════════
3.1  HYPIR 源码
    git clone https://github.com/XPixelGroup/HYPIR app\HYPIR
    （或解压 ZIP 到 app\HYPIR\，保证 app\HYPIR\HYPIR\enhancer\sd2.py 存在）

3.2  HYPIR 权重
    下 HYPIR_sd2.pth（约 400MB）放到 models\hypir\HYPIR_sd2.pth
    官方下载地址见 HYPIR 仓库 README

3.3  Stable Diffusion 2.1 base
    用 huggingface-cli / git lfs / 浏览器下整个 diffusers 目录到 models\sd2_1_base\
    目录里必须有：model_index.json / scheduler/ / text_encoder/ / tokenizer/ / unet/ / vae/
    huggingface 仓库：stabilityai/stable-diffusion-2-1-base

════════════════════════════════════════════════════════════════════════════
  第 4 步：自检 → 启动
════════════════════════════════════════════════════════════════════════════
1. 双击 test_env.bat
   输出会落到 logs\env_check.txt，确保所有项 [OK]
2. 双击 start_hypir.bat
   控制台不打错就成功；浏览器访问 http://127.0.0.1:7865/api/status 应看到 JSON
3. 主软件（梦笔）"工具箱 → AI 修复"卡片会自动检测到服务，可以提交任务

════════════════════════════════════════════════════════════════════════════
  常见问题
════════════════════════════════════════════════════════════════════════════

Q: 端口 7865 被占用？
A: 编辑 config\hypir_config.json 改 port。同时改 start_hypir.bat 里的 7865。

Q: 想让模型加载快一点（避免第一张图等很久）？
A: 编辑 config\hypir_config.json，"eager_load_models": true，启动时就预加载。
   代价是空闲也占 ~6GB 显存。

Q: 想完全离线？
A: 默认已开离线模式（HF_HUB_OFFLINE=1）。但前提是 SD2.1 base 必须是完整本地目录。

Q: 怎么重装 / 修复依赖？
A: 双击 install_or_repair.bat。

Q: 我想换到别的机器？
A: 把整个 HYPIR_Portable\ 拷过去，确认对方有 NVIDIA 驱动 + CUDA 12.1+，
   双击 test_env.bat 检查一遍，OK 就可以直接 start_hypir.bat。

Q: 显存不够（CUDA out of memory）？
A: 在主软件提交任务时把 tile_size 改小（如 256/384），或把倍率从 4 降到 2/3。

Q: 主软件那边显示"服务未启动"？
A: 检查 logs\hypir.log；常见原因是端口没起来 / 模型路径错。

════════════════════════════════════════════════════════════════════════════
