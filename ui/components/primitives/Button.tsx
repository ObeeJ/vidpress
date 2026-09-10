"use client";

import { forwardRef, ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
  loading?: boolean;
}

const variantClass: Record<string, string> = {
  primary:   "btn-primary",
  secondary: "btn-secondary",
  ghost:     "btn",
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "secondary", size = "md", loading, disabled, children, className, style, ...props }, ref) => (
    <button
      ref={ref}
      className={[variantClass[variant], size === "sm" ? "btn-sm" : "", className].filter(Boolean).join(" ")}
      disabled={disabled || loading}
      style={style}
      {...props}
    >
      {loading && <span className="track" style={{ width: 14, height: 14, borderRadius: "var(--radius-full)", display: "inline-block", marginRight: "var(--spacing-2)" }} />}
      {children}
    </button>
  )
);
Button.displayName = "Button";

export default Button;
