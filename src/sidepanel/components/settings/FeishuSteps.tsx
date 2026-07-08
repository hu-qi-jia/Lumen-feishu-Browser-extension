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

export default function FeishuSteps({ steps, current, onChange }: Props) {
  return (
    <div className="feishu-steps">
      {steps.map((step, index) => {
        const isDone = index < current
        const isActive = index === current
        const isPending = index > current
        return (
          <div
            key={index}
            className={[
              'feishu-step',
              isActive && 'feishu-step--active',
              isDone && 'feishu-step--done',
              isPending && 'feishu-step--pending',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <button
              type="button"
              className="feishu-step__indicator"
              onClick={() => onChange?.(index)}
              disabled={!onChange}
              aria-current={isActive ? 'step' : undefined}
            >
              <span className="feishu-step__dot">
                {isDone ? (
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M5 12l5 5L20 7"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  <span className="feishu-step__number">{index + 1}</span>
                )}
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
              {isActive && step.content && (
                <div className="feishu-step__content">{step.content}</div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
