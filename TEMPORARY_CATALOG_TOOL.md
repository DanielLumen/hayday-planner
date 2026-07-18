# 临时目录对照工具记录

本工具用于把 Hay Day Calculator 提供的英文名称和图片，与库存助手现有中文物品及生产设备进行人工一一对应。目录迁移完成后暂时保留，后续确认不再需要时再决定是否删除。

## 临时网页工具

- `catalog-mapping.html`：目录对照工作台入口。
- `catalog-mapping.css`：工作台样式。
- `catalog-mapping.js`：人工对应、草稿保存、筛选、预览和导出逻辑。
- `catalog-mapping-data.js`：为直接打开网页准备的内嵌参考资料和迁移前本地目录快照。
- `catalog-reference.json`：参考网站的英文物品、设备和图片地址快照。
- `catalog-local-base.json`：迁移前的本地中文目录快照。

工作台在当前浏览器没有草稿时，会读取 `catalog-id-image-mapping.json` 显示已经完成的 475 项结果。它不会修改 `data.json`、库存、配方、生产时间或用户图片。

启动项目后可通过以下地址重新查看：

```text
http://localhost:8766/catalog-mapping.html
```

## 迁移记录

- `catalog-id-image-mapping.json`：用户人工确认后的最终中英文名称、旧 ID、新 ID 和图片来源映射。它既供临时工具查看，也作为本次迁移的审计依据；即使以后删除临时网页，也建议继续保留。

## 一次性迁移和审计脚本

以下脚本位于 `tools/`，用于生成资料、审计映射、下载和安装图片、写入 ID 映射及验证迁移结果：

- `apply_catalog_to_index.py`
- `audit_catalog_migration.py`
- `bake_effective_catalog.py`
- `build_catalog_mapping_data.py`
- `cleanup_obsolete_catalog_images.py`
- `download_catalog_images.py`
- `embed_catalog_id_maps.py`
- `install_catalog_images.py`
- `update_placeholder_icons.py`
- `validate_catalog_mapping.py`
- `verify_catalog_migration.py`

这些脚本不参与网页日常运行。以后删除前，应先确认不再需要复核或重新生成本次目录迁移。

## 不能作为临时工具删除的代码

- `catalog-migration.js`：正式应用启动时使用，负责把旧 ID 的浏览器数据和 v3 备份安全迁移到新目录。仍可能有旧版本用户升级，因此不能随临时工具一起删除。
- `item-image-store.js` 中的图片 ID 迁移逻辑：负责迁移用户上传图片。
- `index.html`、`server.js`、`validate.py` 和 `tests/` 中的目录迁移兼容及验证代码：属于正式版本。
- `icons/` 中本次下载的本地图片：属于正式目录资源。

## 暂缓补图

参考网站目前没有对应资料，因此本次保留以下现状：

- 23 个有效物品继续使用占位图。
- 4 个设备或来源没有专用图片：耕地、树木、制糖厂、土耳其烤肉摊。

以后只有找到可靠且能确认对应关系的图片来源时，才进行替换。
