# 发布规范

发布由一条命令完成,流程与门禁由 `scripts/release.mjs` 强制执行。

## 版本号

| 命令 | 版本 | 适用改动 |
|---|---|---|
| `npm run release` | 补丁 | 修复、文档、工具链 |
| `npm run release:minor` | 次版本 | 新功能 |
| `npm run release:major` | 主版本 | 破坏性变更 |

## 流程

1. 预检:本地在 `main`,工作区干净,与 `origin/main` 同步;`package.json` 的 `version` 与最新标签一致;下一个标签未被占用。
2. 门禁:`npm test` → `npm run build` → `npm run verify`。
3. `npm version` 提升版本号并提交,打 `v<版本号>` 附注标签,推送 `main` 与标签。
4. 标签推送触发 `.github/workflows/publish.yml`:门禁 → 校验标签与版本一致 → `npm publish --provenance`(npm Trusted Publishing,OIDC)→ 自动创建 GitHub Release。
5. 脚本等待 Actions 运行结束,确认 npm 的 `latest` 指向新版本,打印 GitHub Release 地址。

## 规则

- 发版时机由维护者决定;`main` 上的提交不自动发版。
- npm 不允许重发同一版本号;发布失败的版本号作废,重跑同一条命令会顺延到下一个版本号。
- 版本标签推送后不得删除或重打。

## 预演

```sh
node scripts/release.mjs check
```

只执行预检与门禁,不改动版本号,用于发版前确认工作区状态。

## 发布失败的处置

- 门禁失败:修复后重跑同一条命令;版本号未消耗。
- Actions 发布失败:版本号已消耗,重跑会顺延;失败运行的原因在 Actions 页面查看。
- Actions 运行失败不回滚标签;失败的版本号作废,新版本号必须在下一版包含同样的修复。
