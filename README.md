# PlayBook

原生微信小程序。广东 21 个地级市显示在同一张离线地图上，可跨市拖动，缩小可查看全省。左上角选择城市可将地图视野移到该市，默认居中茂名。茂名保留现有吃玩点位，其他城市暂未添加点位。旅行路线按城市分开保存在本机。

## 在微信开发者工具中打开

1. 导入此项目目录，选择「小程序」。`playbook/` 是代码根目录，无需安装 npm 依赖。
2. 本地开发可使用测试 AppID。真机测试客服时，用你的正式小程序 AppID 导入，并在小程序管理后台绑定客服人员。
3. 从「吃」点开水东鸭粥，创建路线，在编辑器选中国第一滩。保存后去「书」查看连线。重开小程序再点「书」，可查看保存的路线。
4. 从地图右下角的「反馈」填写表单，点击「复制反馈 → 打开客服」，在会话里粘贴并发送。使用已绑定的微信号查看消息。[微信官方客服工具](https://mpkf.weixin.qq.com/)

## 导入反馈

将客服收到的 JSON 保存为 `feedback.json`。核对地址并补齐 `coordinate`，顺序为 `[经度, 纬度]`，坐标系为 GCJ-02。

```powershell
node tools/add-point.js --from feedback.json
node tools/validate-data.js
```

导入后用开发者工具预览点位，再随新版发布。当前支持写入广东 21 市地图，县级市反馈按目录里的所属地级市导入。茂名点位在 `playbook/data/maoming/points.js`，其余广东城市在 `playbook/data/guangdong/<城市编码>/points.js`。尚未开放地图的城市可以先保留相应反馈文件。

## 数据来源

- 广东区划来自阿里云 DataV。东莞和中山使用省级数据中的市域轮廓，其余城市显示各自的区县边界。运行 `node tools/prepare-geodata.js --guangdong` 可重新生成新加入的 20 市地图，已有点位文件会保留。[广东区划](https://geo.datav.aliyun.com/areas_v3/bound/440000_full.json)
- 全国反馈目录来自民政部国家地名信息库，分为直辖市、地级行政区、县级市及独立地区条目。资料源中的台湾只有地区级条目。运行 `node tools/prepare-geodata.js` 可重新获取茂名区划及全国反馈目录。[茂名区划](https://geo.datav.aliyun.com/areas_v3/bound/440900_full.json) · [国家地名信息库](https://dmfw.mca.gov.cn/)
- 首发美食标记是城区探店范围。中国第一滩使用设计文档中的景区参考点，露天矿生态公园坐标使用高德地名资料。[美食介绍](https://static.nfnews.com/content/202603/21/c12264482.html) · [露天矿生态公园](https://www.amap.com/place/B0FFHON6G1)
