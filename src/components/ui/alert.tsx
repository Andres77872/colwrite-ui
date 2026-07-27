import * as React from "react"
import { type VariantProps } from "class-variance-authority"
import { AlertCircle, CheckCircle2, Info, TriangleAlert } from "lucide-react"
import { cn } from "@/lib/utils"
import { alertVariants } from "./alertVariants"

const VARIANT_ICONS = {
  destructive: AlertCircle,
  warning: TriangleAlert,
  info: Info,
  success: CheckCircle2,
} as const

interface AlertProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof alertVariants> {
  /** Pass `null` to drop the leading icon. */
  icon?: React.ElementType | null
}

/**
 * Alert — the inline status callout.
 *
 * The same "bordered tinted box with an icon and a message" was written out by
 * hand in every research panel, the documents menu, the chats panel and the
 * auth dialog, each with slightly different padding, radius and icon size.
 * `EmptyState` already plays this role for "nothing here"; this is its
 * counterpart for "something is wrong".
 */
const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant = "destructive", icon, children, ...props }, ref) => {
    const Icon = icon === null ? null : (icon ?? VARIANT_ICONS[variant ?? "destructive"])
    return (
      <div
        ref={ref}
        // `alert` is assertive by default, which is right for a failure the
        // user just caused and wrong for ambient notes — callers pass their
        // own `role` (e.g. `status`) when the message is not urgent.
        role="alert"
        className={cn(alertVariants({ variant }), className)}
        {...props}
      >
        {Icon && <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />}
        <div className="min-w-0 flex-1 break-words">{children}</div>
      </div>
    )
  }
)
Alert.displayName = "Alert"

export { Alert }
