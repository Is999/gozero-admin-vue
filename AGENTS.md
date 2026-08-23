# AGENTS.md

本文件是所有 AI Agent 参与本仓库开发的入口。不能直接识别仓库 `.agents/skills` 的 AI Agent，必须先把当前任务需要的 Skill 转换为自身支持的 rule、skill 或 instruction 格式；转换不得省略触发条件、确认闸门、禁止项、引用资源和验证命令。转换规则见 `.agents/skills/standard-development-flow/references/team-adoption.md`。

## 基础骨架保护

- 本仓库承担 vben 管理端基础工程。页面开发、框架演进、重构或跨仓同步可能触及 workspace、共享 package、应用启动、路由守卫、认证会话、安全请求链、统一组件或构建底座时，必须先使用 `$foundation-baseline-guard` 区分页面业务、业务接入和核心变更。
- 核心变更必须说明工程缺陷证据、应用业务层不可解决原因、受影响应用和下游项目、替代方案、验证及回退方式，并取得开发人员明确确认。

## 必须遵守

1. 改代码前先读相关页面、组件、接口封装和现有调用链；涉及后端契约时同步参考 `../admin-go/docs/site/角色文档/后端开发/AI开发提示词.md` 和 `../admin-go/docs/site/角色文档/后端开发/AI开发规范.md`。
2. 功能开发、问题修复、重构、生产级复核和交付前检查必须优先使用 `$standard-development-flow`，再按场景调用专项 skill。
3. 需求或问题表述不充分、存在多种解释、目标页面/接口入口不清或涉及权限、安全、接口契约、数据迁移时，必须先结合代码和文档说明理解、证据、待确认点和执行边界，未经确认不得直接落代码。
4. 延续 vbenjs/vue-vben-admin 与当前项目风格，不新增无必要框架、目录、依赖或抽象。后台页面风格必须统一，优先参考系统管理、任务运维、个人中心等子菜单页面已经验证的布局骨架、标题层级、操作区和卡片样式；页面卡片之间统一保持 8px 间距，避免过紧或过松。表单类页面在原生控件或动态嵌套场景下必须配置稳定、唯一且匹配的 `id`、`name` 与 `label[for]`，已由 Vben Schema Form 或 Ant Form 接管关联时不得重复覆盖。表格页面必须复用仓库既有统一表格组件与适配器，不得为局部页面另起一套表格风格。
5. 需求必须按页面入口、组件链路、接口封装、状态流和交付面逐项闭环；禁止只实现基础 UI、样例、单一分支或 happy path 后伪装已完成。
6. 代码必须简洁、逻辑清晰、易读易维护；合理封装只能用于降低真实复杂度、复用稳定边界或隔离外部依赖，不能过度封装破坏清晰性。
7. 在功能正确和交互闭环前提下，AI 实现必须把简洁、逻辑清晰、易读、易维护和高性能放在最高优先级；优化、重构和过度设计清理必须使用 `$simple-code-guard`，禁止为假设场景增加 wrapper、composable、store 或通用组件。
8. 目录、变量、方法、常量、类型、接口和字段命名必须短而准确、贴合业务职责；禁止泛名、错名、过长命名或实现职责变化后沿用旧名。
9. 每轮落代码前、中、后都必须持续对照工作区 AI 开发规范和本文件；新增或重构的变量、常量、函数、类型、接口、字段、路由、状态结构和关键交互必须补中文注释，避免多轮实现后变成难以审阅维护的无说明代码堆叠。
10. 需求意图不清、问题需先分析、可能存在理解偏差或需要确认执行边界时使用 `$requirement-intent-gate`。
11. 需求实现、收口、闭环、命名审查或交付前完整性复核时使用 `$implementation-closure-review`。
12. vben 页面、路由、菜单、表格、表单、弹窗、状态和完整前端工作流时使用 `$vue-vben-feature-delivery`。
13. 前端 API wrapper、TypeScript 类型、业务码、权限、安全字段或 i18n 与后端契约同步时使用 `$vue-api-contract-client-sync`。
14. 需要浏览器打开、点击、截图、响应式或可视化冒烟时使用 `$vue-e2e-smoke-browser`。
15. pnpm、lockfile、Node/pnpm、postinstall、CI、依赖或 monorepo 工具链失败时使用 `$vue-monorepo-ci-guard`。
16. 路由/按钮权限、禁用态、重复点击、MFA/签名/加密 UI 流程时使用 `$vue-permission-state-audit`。
17. 处理 typecheck、lint、lefthook、commitlint 或提交失败时使用 `$frontend-vben-precommit`。
18. 多个兄弟仓库需要对齐、同步修复或比较同类文件时使用 `$sibling-repo-sync-review`。
19. 交付前 staged 文件、验证结果、后端联动或数据迁移说明收口时使用 `$release-handoff-guard`。
20. 前端业务文案必须支持中英文，优先使用现有 i18n 或 `tBizDynamic`。
21. 敏感操作必须复用既有 MFA、签名、加密和权限能力，不绕过安全校验。
22. 改动后至少执行 `pnpm -F @vben/web-antd run typecheck`；提交失败或大范围改动必须执行 `pnpm exec lefthook run pre-commit`。
23. 交付必须说明修改文件、改动原因、执行检查、未通过项和是否需要后端联动或数据迁移。
24. 每次任务结束前必须检查 `git status --short`；本轮新增且属于交付范围的文件必须执行 `git add` 加入本地仓库索引，不能让应提交文件停留在未跟踪状态，也不能添加无关历史未跟踪文件或本地数据目录。
