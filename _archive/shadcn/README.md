# _archive/shadcn — 已归档，不再使用

本项目于 **2026-07-05** 决定不采用 shadcn / Tailwind / M3 基建，UI 统一使用**纯 CSS**
（语义化 class + 各组件自己的 `.css` + `App.css` 里的 `--color-*` 变量层）。

这里存放的是当时为 shadcn 基建安装、但**从未被业务代码引用**的文件：

- `components.json` — shadcn CLI 配置
- `tailwind.config.cjs` — Tailwind 配置
- `ui/cn.ts` / `ui/button.tsx` / `ui/badge.tsx` — shadcn 组件原语（clsx + tailwind-merge + cva + Radix Slot）
- `ui/hero1.tsx` — 来自 shadcnblocks 的 hero 演示件（孤立，无人引用）
- `ui/tokens.css` — M3 设计 token + Tailwind 入口（曾由 `src/sidepanel/main.tsx` import）

## 同步从 package.json 移除的依赖

- dependencies：`@radix-ui/react-{dialog,label,slot,switch,tabs}`、`class-variance-authority`、`clsx`、`lucide-react`、`tailwind-merge`
- devDependencies：`tailwindcss`
- `postcss.config.cjs` 的 plugins 里去掉了 `tailwindcss`，只留 `autoprefixer`

## 如需恢复

1. 把 `ui/` 移回 `src/sidepanel/ui/`，`components.json`、`tailwind.config.cjs` 移回项目根目录。
2. 在 `src/sidepanel/main.tsx` 重新加 `import './ui/tokens.css'`。
3. `postcss.config.cjs` 的 plugins 里加回 `tailwindcss: {}`。
4. 重装上述依赖。
