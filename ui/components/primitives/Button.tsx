"use client";
import { forwardRef, ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
  loading?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "secondary", size = "md", loading, disabled, children, className = "", ...props }, ref) => {
    const cls = [
      variant === "primary" ? "vpx-button-primary" : "btn",
      size === "sm" ? "btn-sm" : "",
      className,
    ].filter(Boolean).join(" ");

    return (
      <button ref={ref} className={cls} disabled={disabled || loading} {...props}>
        {loading && <span className="track" aria-hidden />}
        {children}
      </button>
    );
  }
);
Button.displayName = "Button";
export default Button;
