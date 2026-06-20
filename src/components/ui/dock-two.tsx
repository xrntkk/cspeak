import * as React from "react"
import { motion } from "framer-motion"
import { cn } from "@/lib/utils"
import { LucideIcon } from "lucide-react"

interface DockProps {
  className?: string
  direction?: "horizontal" | "vertical"
  items: {
    icon: LucideIcon
    label: string
    active?: boolean
    onClick?: () => void
  }[]
}

interface DockIconButtonProps {
  icon: LucideIcon
  label: string
  active?: boolean
  onClick?: () => void
  className?: string
  direction?: "horizontal" | "vertical"
}

const floatingAnimation = {
  initial: { y: 0 },
  animate: {
    y: [-2, 2, -2],
    transition: {
      duration: 4,
      repeat: Infinity,
      ease: "easeInOut" as const
    }
  }
}

const DockIconButton = React.forwardRef<HTMLButtonElement, DockIconButtonProps>(
  ({ icon: Icon, label, active, onClick, className, direction = "horizontal" }, ref) => {
    const vertical = direction === "vertical"
    return (
      <motion.button
        ref={ref}
        whileHover={{ scale: 1.1, y: vertical ? 0 : -2, x: vertical ? 2 : 0 }}
        whileTap={{ scale: 0.95 }}
        onClick={onClick}
        className={cn(
          "relative group p-3 rounded-lg transition-colors",
          active ? "bg-primary/15 text-primary" : "hover:bg-secondary",
          className
        )}
      >
        <Icon className={cn("w-5 h-5", active ? "text-primary" : "text-foreground")} />
        <span className={cn(
          "absolute px-2 py-1 rounded text-xs",
          "bg-popover text-popover-foreground",
          "opacity-0 group-hover:opacity-100",
          "transition-opacity whitespace-nowrap pointer-events-none",
          vertical
            ? "left-full top-1/2 -translate-y-1/2 ml-2"
            : "-top-8 left-1/2 -translate-x-1/2"
        )}>
          {label}
        </span>
      </motion.button>
    )
  }
)
DockIconButton.displayName = "DockIconButton"

const Dock = React.forwardRef<HTMLDivElement, DockProps>(
  ({ items, className, direction = "horizontal" }, ref) => {
    const vertical = direction === "vertical"
    return (
      <div
        ref={ref}
        className={cn(
          "flex items-center justify-center p-2",
          vertical ? "h-full w-full flex-col" : "w-full h-64",
          className
        )}
      >
        <div className={cn(
          "rounded-2xl flex items-center justify-center relative",
          vertical ? "h-full w-full flex-col" : "w-full max-w-4xl h-64"
        )}>
          <motion.div
            initial="initial"
            animate="animate"
            variants={floatingAnimation}
            className={cn(
              "flex p-2 rounded-2xl",
              "backdrop-blur-lg border shadow-lg",
              "bg-background/90 border-border",
              "hover:shadow-xl transition-shadow duration-300",
              vertical ? "flex-col gap-1" : "flex-row items-center gap-1"
            )}
          >
            {items.map((item) => (
              <DockIconButton key={item.label} {...item} direction={direction} />
            ))}
          </motion.div>
        </div>
      </div>
    )
  }
)
Dock.displayName = "Dock"

export { Dock }
