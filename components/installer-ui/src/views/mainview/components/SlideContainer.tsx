import { AnimatePresence, motion } from "framer-motion";
import type { ReactNode } from "react";

import type { StepId } from "../../../shared/installer-types";

type SlideContainerProps = {
  children: ReactNode;
  direction: number;
  step: StepId;
};

const slideVariants = {
  enter: (direction: number) => ({
    x: direction >= 0 ? "4%" : "-4%",
    opacity: 0,
    scale: 0.985,
  }),
  center: {
    x: 0,
    opacity: 1,
    scale: 1,
  },
  exit: (direction: number) => ({
    x: direction >= 0 ? "-4%" : "4%",
    opacity: 0,
    scale: 0.985,
  }),
};

export function SlideContainer({ children, direction, step }: SlideContainerProps) {
  return (
    <div className="relative flex-1 overflow-hidden">
      <AnimatePresence custom={direction} mode="wait">
        <motion.section
          animate="center"
          className="absolute inset-0 flex items-center justify-center overflow-hidden will-change-transform"
          custom={direction}
          exit="exit"
          initial="enter"
          key={step}
          transition={{
            x: { type: "spring", stiffness: 230, damping: 28 },
            opacity: { duration: 0.24 },
            scale: { duration: 0.24 },
          }}
          variants={slideVariants}
        >
          {children}
        </motion.section>
      </AnimatePresence>
    </div>
  );
}
