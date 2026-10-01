# Brainpile

> [!WARNING]
> 该项目还在积极开发中，目前以增加新功能为重心。

## 如何使用

### 配置

处理视频需要安装 `ffmpeg`。

复制并编辑 `.env` ：

```bash
cp .env.example .env
```

编辑 `.env`，填入 VLM 和 Telegram Bot 配置。

### Docker Compose 部署

若不需要某项服务（例如 S3 改为外接），可在 `docker-compose.yml` 中删除对应服务。

配置好 `.env` 后，构建并启动全部服务：

```bash
docker compose up -d --build
```

若从其他设备访问，需要把 `docker-compose.yml` 中后端的 `S3_PUBLIC_ENDPOINT` 改成浏览器可访问的地址。

### 开发

1. 启动数据库、对象存储和嵌入服务：

   ```bash
   docker compose up -d --build postgres seaweedfs brainpile-jina
   docker compose logs -f postgres seaweedfs brainpile-jina # 查看日志
   ```

   等待服务就绪；嵌入服务首次启动会下载模型，可能需要较长时间。按 `Ctrl+C` 退出日志查看不会停止容器。如果此前已启动完整服务，先执行 `docker compose stop brainpile-core brainpile-frontend`，再运行本地前后端。

2. 启动后端：

   ```bash
   cargo run -p brainpile-core
   ```

   后端监听 `http://localhost:8080`，同时运行 Telegram Bot 和后台任务。修改后端代码后需重启后端。

3. 启动前端：

   ```bash
   cd frontend
   pnpm install --frozen-lockfile
   pnpm dev
   ```

   前端位于 `http://localhost:5173`。Vite 支持前端热更新，并将 `/api` 请求代理到本地后端的 `8080` 端口。

## 本地存储

对象存储默认使用 [SeaweedFS](https://github.com/seaweedfs/seaweedfs) ，也可自行接入其它 S3 兼容对象存储。

持久化数据：

| 本地目录 | 用途 |
| --- | --- |
| `./data/postgres` | PostgreSQL 16 数据 |
| `./data/seaweedfs` | SeaweedFS 对象和元数据 |
| `./models` | 嵌入模型缓存 |

## 嵌入模型（jina-embeddings-v5-omni）

语义检索使用 [jina-embeddings-v5-omni-nano-retrieval](https://huggingface.co/Yirasumi/jina-embeddings-v5-omni-nano-retrieval-GGUF)（GGUF 量化版），通过 `brainpile-jina` 服务以 jina fork 的 llama.cpp（`feat-v5-omni` 分支）运行。文本与图片被映射到**同一个 768 维向量空间**，因此文搜图、以图搜图都走同一路向量召回。

> [!NOTE]
> 该模型许可为 **CC-BY-NC-4.0（非商业用途）**，请注意合规。

### 模型为什么不打包进镜像

`brainpile-jina` 镜像**只包含编译好的 `llama-server` 二进制**，不含模型权重。模型（约 480 MB）默认存放在项目根目录的 `models/` 目录（通过绑定挂载映射到容器 `/models`），该目录已加入 `.gitignore` 不会入库。若目录中缺少模型文件，容器**首次启动时会自动从 HuggingFace 下载**并持久化到本地，之后命中缓存直接复用。这样做的好处：

- 镜像保持精简，代码改动重建不必携带大体积权重层；
- 规避把非商用权重直接打包进镜像分发带来的许可风险；
- 更换量化版本或更新模型无需重建镜像。

涉及的文件（由 [jina/entrypoint.sh](jina/entrypoint.sh) 下载，放在 `models/` 下）：

| 文件 | 用途 |
| --- | --- |
| `jina-embeddings-v5-omni-nano-retrieval-Q4_K_M.gguf` | 主模型权重（token_embd 保留 F16） |
| `mmproj-jina-embeddings-v5-omni-nano-retrieval-F16.gguf` | 视觉投影层（图片/视频嵌入必需） |

如已有本地 GGUF，可直接以上述文件名放进 `models/` 目录，启动时会跳过下载。

## 特性
- 你会发现代码注释是中文的，网页却是英文的
- 在Telegram中，无论一组图中有几张图，用户只能对它点一个reaction，且bot看来这个reaction是点到第一张图上的；bot可以给组图内多个item点reaction，但用户只能看到一个reaction。所以：
  - bot只会给组图的第一张图点reaction，尽管每张图都是一个item
  - 只有整组图处理完毕，bot才会点❤️；如果有一张图处理失败，bot就会给整组图点👎
  - 用户对组图点的reaction，bot会视为对每张图都点了相同的reaction
  - 已知问题：若有一张图处理失败，其它图还是会被正常导入。需要编写tasks的回滚策略。

- Random页刷得越多内存占用越大
- Random页一直向下刷可以刷到重复的，这是有意为之。所以如果你的数据很少，Random页会经常出现重复的
  - 但是组图做过处理，你刷不到相同的一组图

## 路线图

### 马上就做
- [ ] 统一配色
- [ ] 视频加上播放小三角
- [ ] 瀑布流重排动画
- [ ] 骨架

### v0.x
- [ ] 用户认证
- [ ] 视频处理
- [ ] 注释掉占坑的按钮
- [ ] 筛选后搜索（现在无论哪里搜索，都是全局的）
- [ ] 移动端UI

### v1.0.0
- [ ] 部署文档

### v1.x
- [ ] 以图搜图
- [ ] 桌面/手机客户端
- [ ] Random页换成智能推荐页（还没想好推荐算法）
- [ ] 软删除/回收站
- [ ] Web/App端上传

### 很快就有
- [ ] 链接出卡片/标题
- [ ] PDF出首页缩略图
- [ ] PDF OCR
- [ ] 多语言
- [ ] 更多数据源
