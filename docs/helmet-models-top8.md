# 园区骑行头盔识别模型评测 · 前八个模型

固定评测集 v1，共 160 张原图。132 个模型中，Lixiaoyang_Ebike 的整图正确数最高（154 张）。演示系统使用的 Co-DETR v1 epoch 2 多判对 4 张未戴盔图，少判对 6 张戴盔图，总体并列第三。评测定稿于 2026 年 11 月 13 日。

## 固定评测集成绩

| 名次 | 模型 | 总体正确 | 未戴盔图判对 | 戴盔图判对 | 戴盔误报未戴（张） | 无法判断（张） |
|---:|---|---:|---:|---:|---:|---:|
| 1 | Lixiaoyang_Ebike | 154/160（96.25%） | 106/110（96.36%） | 48/50（96.00%） | 2 | 2 |
| 2 | Co-DETR v1 epoch 16 | 153/160（95.62%） | 109/110（99.09%） | 44/50（88.00%） | 3 | 3 |
| 3 | Co-DETR v1 epoch 2 | 152/160（95.00%） | 110/110（100.00%） | 42/50（84.00%） | 7 | 1 |
| 3 | phivnnguyn · helmet-detection-64-0-0001 | 152/160（95.00%） | 105/110（95.45%） | 47/50（94.00%） | 3 | 1 |
| 5 | Smolry_Second | 151/160（94.38%） | 103/110（93.64%） | 48/50（96.00%） | 2 | 3 |
| 6 | Advaya-ab · model2_helmet_plate | 147/160（91.88%） | 100/110（90.91%） | 47/50（94.00%） | 3 | 6 |
| 6 | nguynvlun · helmet-yolov8n | 147/160（91.88%） | 102/110（92.73%） | 45/50（90.00%） | 4 | 4 |
| 6 | nguynvlun · helmet-yolov8s | 147/160（91.88%） | 102/110（92.73%） | 45/50（90.00%） | 5 | 4 |

原榜按总体正确张数降序排列，同分并列。五个模型同为第 6 名，本表沿用原榜顺序截取前八行。其余两款同分模型为 Suman-SG_best_c567b 和 Youtu-VL-4B-native，均为 147/160（91.88%）。

## 评测口径

110 张未戴盔照片来自园区，50 张戴盔照片来自 RHNP 测试集。每个模型使用相同的原图，遮住文字信息，按预定布局拆分拼图，再将各视图结果合回原图。任一视图发现未戴盔骑手即报未戴盔，仅检出戴盔骑手时判为戴盔，无法判断计错。训练与本地调参均排除固定集及其衍生画面。Co-DETR v1 epoch 2 使用已保存的原始检测框按本轮规则重新计分。

两类照片来源不同，表中正确率仅描述这批样本。园区照片的人工标签精确到整图。以 Lixiaoyang_Ebike 为例，108 次未戴盔告警中，AI 目视复核认为主框支持目标车骑手未戴盔的有 82 次（75.93%）。逐车识别效果仍需目标车和骑手的人工标注来衡量。

## 权重下载与推理配置

| 模型 | 权重下载与来源 | 文件名（压缩包内取此文件） | 本次推理配置 |
|---|---|---|---|
| Lixiaoyang_Ebike | [下载权重](https://raw.githubusercontent.com/lixiaoyang612/Helmet-Detection-YOLOv8-PyQt5/f56938c20fa6895a4222bbc38782d60440d3c629/best.pt) · [作者项目](https://github.com/lixiaoyang612/Helmet-Detection-YOLOv8-PyQt5) | `best.pt` | 640 px，置信度 0.25，IoU 0.7 |
| Co-DETR v1 epoch 16 | [OneDrive 目录](https://1drv.ms/f/s!AqGcdYmA92Q_m8No_7x_r_bdZ8MlHA?e=pmAbHv) · [作者项目](https://github.com/VNPT-AI-Official/AICITY2024_Track5) | `v1_epoch_16.pth` | 2048 × 1280 等比缩放，判定阈值 0.25 |
| Co-DETR v1 epoch 2 | [OneDrive 目录](https://1drv.ms/f/s!AqGcdYmA92Q_m8No_7x_r_bdZ8MlHA?e=pmAbHv) · [作者项目](https://github.com/VNPT-AI-Official/AICITY2024_Track5/tree/4b68684aaecd1b77d12ff989cac264d5df127d73) | `v1_epoch_2.pth` | 2048 × 1280 等比缩放，判定阈值 0.25 |
| phivnnguyn · helmet-detection-64-0-0001 | [下载压缩包](https://www.kaggle.com/api/v1/models/phivnnguyn/helmet-detection-64-0-0001/TensorFlow2/default/1/download) · [作者项目](https://www.kaggle.com/models/phivnnguyn/helmet-detection-64-0-0001) | `helmet_64_0.0001.pt` | 640 px，置信度 0.25，IoU 0.7 |
| Smolry_Second | [下载权重](https://huggingface.co/Smolry/Helmet-classifer/resolve/91e498a0a6bf2972ec52c36fc5ed0724341bc461/helmet_detector2.pt) · [作者项目](https://huggingface.co/Smolry/Helmet-classifer) | `helmet_detector2.pt` | 640 px，置信度 0.25，IoU 0.7 |
| Advaya-ab · model2_helmet_plate | [下载权重](https://huggingface.co/Advaya-ab/traffic-violation-model2/resolve/9e3839807098752a69afdebc073bf6edd7ce00d6/model2_helmet_plate.pt) · [作者项目](https://huggingface.co/Advaya-ab/traffic-violation-model2) | `model2_helmet_plate.pt` | 640 px，置信度 0.25，IoU 0.7 |
| nguynvlun · helmet-yolov8n | [下载压缩包](https://www.kaggle.com/api/v1/models/nguynvlun/helmet-yolov8n/TensorFlow2/default/1/download) · [作者项目](https://www.kaggle.com/models/nguynvlun/helmet-yolov8n) | `yolov8n_helmet.pt` | 640 px，置信度 0.25，IoU 0.7 |
| nguynvlun · helmet-yolov8s | [下载压缩包](https://www.kaggle.com/api/v1/models/nguynvlun/helmet-yolov8s/TensorFlow2/default/1/download) · [作者项目](https://www.kaggle.com/models/nguynvlun/helmet-yolov8s) | `yolov8s-helmet.pt` | 640 px，置信度 0.25，IoU 0.7 |

六个 GitHub、Hugging Face 和 Kaggle 下载入口均已通过文件分段读取核验。两个 Co-DETR 权重使用 VNPT 同一个 OneDrive 共享入口，打开后进入 `CODETR-checkpoints`，按上表选择对应文件。该入口在本次命令行检查时返回 HTTP 403。epoch 2 另可通过本仓库的 [v0.1.1 完整演示包](https://github.com/LMSyyds/helmet-review-demo/releases/tag/v0.1.1) 获取。

### 评测所用权重的 SHA-256

以下校验值对应解压后的单个权重文件。

```text
a36142124668b56001cae23ecd0d632d1c6f9c1592afb6b8ec86ac1a248da253  best.pt
d02e5165fdfa218e32782519f665192131a8b4dbec4fd769814c8a431840309a  v1_epoch_16.pth
744b026d86affdfd04cf65076d42e4d07da36024f4c9c70eef53e238af90682e  v1_epoch_2.pth
9e8df02b0aebd9d9c70a763412c42b42ad6faf6ff8f801a16f08193ca198d0b9  helmet_64_0.0001.pt
58b6f5c07d9ce77dc643cee9a821e48861fc02b1ca81b1083a415a11efaa170b  helmet_detector2.pt
9e8900924fdc8be876026fd8469bf19ce595975cc83185af48c1ed6cce6b1b16  model2_helmet_plate.pt
98eca5498313c511f334bf4660a9137f1b5ac8485432a81c9632eceaa0e6dd23  yolov8n_helmet.pt
bda2e0d7de442c79716b7d71271e8c4ccc9eb31546e534017ef49e7a5d4f9e9a  yolov8s-helmet.pt
```
