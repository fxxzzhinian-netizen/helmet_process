# 园区头盔复核演示网站

汇报人可以提前上传一批抓拍，现场选择照片做真实推理，从原图切换到检测框，再把需要人工判断的事件处理完，查回相应违章记录。所有记录保存在本演示库。

[头盔模型评测报告与权重下载（前八个模型）](docs/helmet-models-top8.md)

## 获取完整演示包

打开 [v0.1.1 发布页](https://github.com/LMSyyds/helmet-review-demo/releases/tag/v0.1.1)，下载 `helmet-review-demo-v0.1.1.zip` 和 `SHA256SUMS.txt`。完整包内含网站源码、构建好的前端、Co-DETR 权重、推理代码、模型配置及随附依赖。GitHub 自动生成的 Source code 压缩包只包含仓库文件。

在下载目录运行 `shasum -a 256 -c SHA256SUMS.txt` 核对压缩包。解压后进入项目目录。Apple Silicon Mac 使用 Python 3.11，可执行以下命令准备环境并启动。

```sh
python3.11 -m venv .venv
.venv/bin/python -m pip install --no-index --find-links model/runtime/CoDETR_v1_epoch_2/env/wheels -r model/runtime/CoDETR_v1_epoch_2/env/requirements.txt
.venv/bin/python -m pip install -r backend/requirements.txt
./scripts/start.sh
```

Linux 和 Windows 服务器按[部署说明](docs/部署.md)安装对应驱动和依赖。首次启动自动创建空演示库。

## 启动网站

已配置好的这台 Mac 可双击项目里的 **启动演示.command** 自动打开浏览器，也可以在终端进入项目目录执行：

```sh
./scripts/start.sh
```

浏览器打开 **http://127.0.0.1:8765/**。本机默认使用 CPU 运行真实模型。保持终端打开，按 Ctrl+C 停止；下次用相同命令启动即可继续原有批次。若提示端口占用，可直接访问已启动的服务。

新机器先根据 [服务器部署与数据维护](docs/部署.md) 配置模型运行环境并构建前端。可独立设置 HELMET_MODEL_DIR、HELMET_DEVICE、HELMET_DATA_DIR、HELMET_PYTHON、HELMET_HOST 和 HELMET_PORT。启动脚本同时运行模型服务（默认端口 8766）和网站进程。设置 HELMET_MODEL_URL 后只启动网站，并调用该地址的模型服务。网页无需单独启动开发服务器。Windows 使用 `scripts\start.cmd`。

## 准备 100 张照片

[下载园区抓拍原图（白天、夜间各 500 张）](https://github.com/LMSyyds/helmet-review-demo/releases/tag/captures-20261114)。如用于计算正确率，请先为测试照片提供人工核实的标签。

每张原图使用不同的文件名。可以只上传照片；希望现场统计正确率时，同时上传 UTF-8 CSV。文件名需与待测图片一致，包括扩展名。格式见 [标签示例](examples/labels.csv)：

```csv
filename,prediction
example_helmet.jpg,helmet
example_no_helmet.jpg,no_helmet
```

支持 JPEG、PNG 和 WebP。一次可选 1 至 500 张，单张最多 32 MiB、6400 万像素，整批请求最多 1 GiB。上传与识别独立，可提前上传，现场勾选几张开始测试。

这里的 prediction 列填写**人工答案**。图中任意骑行人或同车乘客未戴盔，填 no_helmet；全部已戴盔，填 helmet。没有人工答案的图片仍可以参与识别。界面用“答对张数 / 已完成且有标签的张数”显示本批成绩，模型返回“无法判断”计错。现场批次的成绩与项目固定评测集的成绩分开报告。

标签文件只有 filename 和 prediction 两列，带其他列的文件会被拒绝。每张照片中可区分的车辆各自生成一条事件。

## 汇报时的操作

1. 在「识别工作台」点击「上传图片」，选择照片和可选标签文件，上传后进入「已上传」列表。提前传好的图片可在汇报当天直接选择。
2. 在「已上传」列表勾选图片点击「处理已选」，或点击「处理全部」。照片真正经过 Co-DETR v1 epoch 2，逐张返回结果。第一次识别包括模型加载时间。
3. 打开已完成的图片，切换原图、检测框。框表示模型检测到的车辆或整名骑乘人员；中文标签说明角色与戴盔判断。
4. 前后座均参与判断。同一辆车上明确有人未戴盔，系统生成演示违章事件；能确认已戴盔则排除；归属或可见性不足的事件可进入人工审核。审核队列可以为空。
5. 从违章记录查回照片和判断来源。人工决定属于业务记录，模型原始输出与图级得分独立保留。

## 实施与验证

- [后台服务](backend/README.md)负责原图存储、真实推理队列、审核和违章记录。
- [模型接入](model/README.md)说明权重校验、CPU / CUDA 配置和检测框语义。保留原始模型结论，车辆关联属于业务处理。
- [联调验收](docs/联调验收.md)记录实际浏览器操作、坐标检查和测试范围。
- [服务器部署](docs/部署.md)包含重启、数据迁移与备份说明。
- 同一批次已完成的图片保留识别结果。需对同一张照片重新运行模型时，重新上传到新批次，两个批次可分别回看。

## 维护

功能范围与模块职责见 [开发计划](docs/开发计划.md)，请求、返回值和状态见 [接口约定](docs/接口约定.md)。版本变更写入 [CHANGELOG](CHANGELOG.md)。权重、用户照片和数据库位于 Git 之外；复制源码仓库不会带走现场数据。

发布时同步更新 frontend/package.json 和锁文件的版本，在 CHANGELOG.md 写明功能变化和验收范围，执行模块回归与前端构建，通过后给发布提交打 Git 标签。可用 `git log --oneline --decorate` 查各版本与模块提交。
