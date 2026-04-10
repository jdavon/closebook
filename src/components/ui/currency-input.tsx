"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";

interface CurrencyInputProps
  extends Omit<
    React.ComponentProps<"input">,
    "value" | "onChange" | "type"
  > {
  /** Raw numeric string (e.g. "1234.56"), the same shape existing form state uses. */
  value: string;
  /** Called with the stripped numeric string on every change. */
  onValueChange: (value: string) => void;
  currency?: string;
}

function formatDisplay(raw: string, currency: string): string {
  if (raw === "" || raw == null) return "";
  const num = parseFloat(raw);
  if (Number.isNaN(num)) return raw;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

/** Strip display characters — currency symbol, thousands separators, spaces. */
function stripFormatting(input: string): string {
  return input.replace(/[^0-9.\-]/g, "");
}

function CurrencyInput({
  value,
  onValueChange,
  onFocus,
  onBlur,
  currency = "USD",
  className,
  ...rest
}: CurrencyInputProps) {
  const [focused, setFocused] = React.useState(false);
  const display = focused ? value : formatDisplay(value, currency);

  return (
    <Input
      {...rest}
      type="text"
      inputMode="decimal"
      value={display}
      className={className}
      onFocus={(event) => {
        setFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        onBlur?.(event);
      }}
      onChange={(event) => {
        onValueChange(stripFormatting(event.target.value));
      }}
    />
  );
}

export { CurrencyInput };
