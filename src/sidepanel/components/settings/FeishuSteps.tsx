import type { ReactNode } from 'react'

export interface FeishuStep {
  title: ReactNode
  description?: ReactNode
  content?: ReactNode
}

interface Props {
  steps: FeishuStep[]
  current: number
  onChange?: (index: number) => void
}

/** 纵向步骤条：仅用于展示步骤顺序，默认全部展开，无完成态样式。 */
export default function FeishuSteps({ steps, current, onChange }: Props) {
  return (
    <div className="feishu-steps">
      {steps.map((step, index) => {
        const isActive = index === current
        return (
          <div
            key={index}
            className={['feishu-step', isActive && 'feishu-step--active'].filter(Boolean).join(' ')}
          >
            <button
              type="button"
              className="feishu-step__indicator"
              onClick={() => onChange?.(index)}
              disabled={!onChange}
              aria-current={isActive ? 'step' : undefined}
            >
              <span className="feishu-step__dot">
                <span className="feishu-step__number">{index + 1}</span>
              </span>
              {index < steps.length - 1 && <span className="feishu-step__line" />}
            </button>
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
