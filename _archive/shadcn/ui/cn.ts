import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * 合并 Tailwind class：clsx 处理条件/class 数组，twMerge 解决冲突（后者覆盖前者）。
 * shadcn 组件与业务组件统一用它拼 className。
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
