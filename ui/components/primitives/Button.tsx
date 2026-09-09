"use client";

import { forwardRef, ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
  loading?: boolean;
}

const variantClass: Record<string, string> = {
  primary:   "vpx-button-primary",
  secondary: "vpx-button-secondary",
  ghost:     "btn",
};

const sizeStyle: Record<string, React.CSSProperties> = {
  sm: { padding: "0.375rem 0.75rem", fontSize: "var(--text-xs)" },
  md: {},
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "secondary", size = "md", loading, disabled, children, style, ...props }, ref) => (
    <button
      ref={ref}
      className={variantClass[variant]}
      disabled={disabled || loading}
      style={{ ...sizeStyle[size], ...style }}
      {...props}
    >
      {loading && <span className="track" style={{ width: 14, height: 14, borderRadius: "var(--radius-full)", display: "inline-block", marginRight: "var(--spacing-2)" }} />}
      {children}
    </button>
  )
);
Button.displayName = "Button";

export default Button;
