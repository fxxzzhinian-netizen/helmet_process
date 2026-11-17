# 后台启动与交接

在项目根目录用 Python 3.11 安装依赖并启动。后台通过 HTTP 调用模型服务，地址由 `HELMET_MODEL_URL` 指定，默认 `http://127.0.0.1:8766`。模型服务只返回画面范围和检测框，整图结论与逐车判定由 `backend/rules.py` 得出，其中跨画面的车辆比对使用 OpenCV。模型服务给出上下二联图的截取关系时，规则先把上下两图的检测框合并成一份目标再判定，合并结果保存在 `model_result.merged_detections`，取值见[接口约定](../docs/接口约定.md)。配对阈值 `MATCH_IOU` 和置信度接近阈值 `CLOSE_CONFIDENCE` 是 `backend/rules.py` 顶部的常量。后台环境只需下列依赖；真实识别还需按模型模块说明另行启动 `python -m model.server`。

```sh
python -m pip install -r backend/requirements.txt
HELMET_DATA_DIR=/绝对路径/演示库 python -m backend --host 127.0.0.1 --port 8000
```

默认数据目录为项目根目录的 `data/`，默认端口为 8000。浏览器联调可单独设 `HELMET_DATA_DIR="$(mktemp -d)"`。同源静态目录默认为 `frontend/dist`，可用 `HELMET_FRONTEND_DIST` 指定其他构建目录。服务用 Waitress 提供 HTTP，Flask 提供路由，每个数据目录使用一个进程和一个串行推理线程。

## 请求与数据含义

- 上传字段为 `name`、重复的 `files` 和可选的 `labels`。可接收单帧 JPEG、PNG、WebP。每批 1–500 张，单文件最大 32 MiB、6400 万像素，整个 HTTP 请求最大 1 GiB。图片按上传顺序显示，批次按新建顺序倒排，事件按批次倒序、上传顺序、模型车辆顺序排列。
- 标签文件为 UTF-8 CSV（支持 BOM），表头只能是 `filename,prediction` 两列，人工真值只接受 `helmet` 或 `no_helmet`。可提供部分标签，没有标签的照片不写入该行。表头含其他列时拒绝整个批次。同批重名、损坏图片、标签重复或无法匹配会拒绝整个批次。
- 对已上传但尚未成功识别的图片，可在工作台勾选后启动；失败项可用同一入口重试。`POST /api/batches/{id}/run` 支持 `{"image_ids":["图片ID"]}`，省略字段或传空数组时处理整批。返回 HTTP 202、`accepted` 本次新入队张数及 `message`。并发点击及成功项重试均跳过已入队或已完成项。**要再次真实推理已完成的照片，请将照片上传到新批次**，以便保留此前判断、审核和计分。
- `processed` 是成功与失败张数之和；`done`、`failed`、`running`、`queued` 分开提供。一批仅运行部分图片且还有待处理项时，空闲批次回到 pending。重启后接续未处理队列，并重试中断的运行项。主动选中的失败项才重新入队。
- `score` 仅统计有独立标签且已成功完成推理的图片，`unknown` 计错，零分母返回 null。人工审核保留原图级结论、得分与 `model_result`。图片详情提供当前 `vehicles`、`events` 及原始适配器输出 `model_result`（包含适配器返回的权重、配置哈希等字段）。
- 每个模型车辆组对应一个持久事件 ID；未产生任何车辆组时仅创建一条图级待复核事件，`scope=image` 且 `vehicle_id=null`。`/api/reviews` 与 `/api/violations` 可按 `source`、`batch_id`、`image_id` 过滤。列表返回模型理由、关联检测框和当前决定；审核或改判使用事件 ID。相同决定与备注重复提交只登记一次；可传已有 `revision` 检查过期编辑。通过 `GET /api/events/{id}` 查询包括已排除事件在内的完整改判历史。
- `GET /api/images/{id}/original` 返回与模型一致的坐标画面。需要 EXIF 转向时使用无损 PNG 保存转向后的像素，`/api/images/{id}/uploaded` 始终提供上传原始字节。其余图片沿用上传文件。
- 停止服务后备份或恢复整个 `HELMET_DATA_DIR`，其中包括 `review.sqlite3` 和 `uploads/`。首次启动自动创建；一个数据目录只能由一个服务进程持有。

## 已验证

使用 Python 3.11、Flask 3.1.3、Waitress 3.0.2 在本机临时目录验证。项目根目录运行 `python -m unittest backend.test_backend -v` 可重放队列、上传原子性、打分、并发入账及审核、重启恢复等回归。测试中的确定性模型用于触发错误与重试，不产生模型性能指标。

另已通过本地 Waitress HTTP 一次上传 100 张真实 JPEG（156,457,688 字节），含 8192×6336 四联抓拍，读取该图并核对 SHA-256 与上传原件一致。此次百张测试只覆盖上传。另通过本地 HTTP 和可控适配器，在第一张已进入 running、第二张仍在队列时强制结束服务进程，使用同一临时库重启。两张均能恢复处理，失败项再试成功；重复提交同一审核后，历史仅有一次登记。