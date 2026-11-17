# 原始 CSV 字段清点

来源：`E:/AAA_DAIL/helmet/data/park2000_20261116_001106/manifest.csv`。
清点日期：2026-11-16；编码：UTF-8 BOM；资料 2000 条，字段 43 列。

按每列实际非空单元格清点，空字符串与纯空白不计入，`0` 计为有效数据。
共 36 列有数据，7 列全部为空。原始文件保持不变。
按当前导出要求另行排除身份关系、辖区、部门、手机号及其字段别名。其中 `phone` 原始有值 1980 条，也按指定移除，因此全量资料最多保留 35 列。

| 原始列名 | 有值条数 | 全量导出 |
| --- | ---: | --- |
| file | 2000 | 保留 |
| imageField | 2000 | 保留 |
| sha256 | 2000 | 保留 |
| width | 2000 | 保留 |
| height | 2000 | 保留 |
| id | 2000 | 保留 |
| mbId | 2000 | 保留 |
| miId | 2000 | 保留 |
| rfidChip | 2000 | 保留 |
| vehicleRecordId | 2000 | 保留 |
| plateNumber | 1031 | 保留 |
| plateColor | 2000 | 保留 |
| vehicleIllegaType | 2000 | 保留 |
| vehicleIllegaTypeStr | 2000 | 保留 |
| violationDesc | 2000 | 保留 |
| dataSource | 2000 | 保留 |
| alarmTime | 2000 | 保留 |
| overspeedRatio | 0 | 移除 |
| speed | 2000 | 保留 |
| limitSpeed | 0 | 移除 |
| address | 2000 | 保留 |
| campus | 2000 | 保留 |
| img1 | 2000 | 保留 |
| img2 | 760 | 保留 |
| img3 | 5 | 保留 |
| videoChannel | 2000 | 保留 |
| cameraChannelId | 2000 | 保留 |
| status | 2000 | 保留 |
| reviewer | 4 | 保留 |
| reviewTime | 4 | 保留 |
| confirmedViolationId | 0 | 移除 |
| deptId | 2000 | 保留 |
| createTime | 2000 | 保留 |
| createBy | 2000 | 保留 |
| updateTime | 4 | 保留 |
| updateBy | 0 | 移除 |
| remark | 0 | 移除 |
| ownerName | 1998 | 保留 |
| phone | 1980 | 按指定移除 |
| memberNo | 1998 | 保留 |
| departmentName | 0 | 按指定移除（全空） |
| carNo | 2000 | 保留 |
| personDetail | 0 | 移除 |

导出按当前条件命中的关联原始资料重新清点，表头翻译为中文，保留原始字段顺序与单元格值。
某列在全部 2000 条中有值，但在本次筛选资料中全空时，也会自动移除。
不同批次资料的字段取并集，同名字段对齐；没有对应原始资料的事件不生成空白行。
原始 `status`、`reviewer`、`reviewTime` 是原资料中的审核信息，导出原值，不替换为本系统的模型结论或人工复核信息。
