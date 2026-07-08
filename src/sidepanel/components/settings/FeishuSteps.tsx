import type { ReactNode } from 'react'

export interface FeishuStep {
  title: ReactNode
  description?: ReactNode
  content?: ReactNode
}

interface Props {
  steps: FeishuStep[]
  current: number
}

/** 纵向步骤条：纯展示，点击不切换步骤。 */
export default function FeishuSteps({ steps, current }: Props) {
  return (
    <div className="feishu-steps">
      {steps.map((step, index) => {
        const isActive = index === current
        return (
          <div
            key={index}
            className={['feishu-step', isActive && 'feishu-step--active'].filter(Boolean).join(' ')}
          >
            <div className="feishu-step__indicator" aria-current={isActive ? 'step' : undefined}>
              <span className="feishu-step__dot">
                <span className="feishu-step__number">{index + 1}</span>
              </span>
              {index < steps.length - 1 && <span className="feishu-step__line" />}
            </div>
            <div className="feishu-step__body">
              <div className="feishu-step__header">
                <span className="feishu-step__title">{step.title}</span>
                {step.description && (
                  <span className="feishu-step__desc">{step.description}</span>
                )}
              </div>
              {step.content && <div className="feishu-step__content">{step.content}</div>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
