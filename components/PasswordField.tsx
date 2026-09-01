"use client";

import { useId, useState } from "react";

/**
 * A password input with a show/hide toggle.
 *
 * Every password field in the product goes through here rather than being a bare
 * `type="password"`, so the reveal is a property of the product and not something
 * each new form has to remember.
 *
 * WHY REVEAL AT ALL. Masking defends against someone reading over a shoulder, and
 * that is a real threat in an office and a mostly imaginary one for a lender
 * standing alone at a boat ramp on a phone keyboard that has already helpfully
 * capitalised the first letter. The cost of masking is silent, repeated typos on
 * the exact field where a typo is least recoverable — and the usual response to
 * that, pasting from a note or giving up and resetting, is worse for security
 * than letting someone look at what they typed. NIST has recommended offering
 * this since SP 800-63B; every mainstream OS keyboard already does it.
 *
 * Hidden by default, always. The reveal is a deliberate act by the person at the
 * keyboard, who is the only one who knows whether anyone is behind them.
 *
 * The state is per-field and per-mount: it is never persisted, never lifted into
 * a parent, and never shared between two password inputs on one screen. A form
 * with "new password" and "confirm password" reveals one without revealing the
 * other, which is what makes revealing safe to offer on a shared screen.
 */
export function PasswordField({
  value,
  onChange,
  autoComplete,
  required,
  minLength,
  name,
  id,
  placeholder,
  className,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  /** "current-password" or "new-password". Passed straight through so password managers still work. */
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
  name?: string;
  id?: string;
  placeholder?: string;
  /** The input's own classes. The right padding for the button is added here. */
  className?: string;
  disabled?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const generatedId = useId();
  const inputId = id ?? generatedId;

  return (
    <div className="relative">
      <input
        id={inputId}
        name={name}
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        required={required}
        minLength={minLength}
        placeholder={placeholder}
        disabled={disabled}
        // Only meaningful once the field is a text input. A revealed password on
        // a phone would otherwise be autocapitalised, autocorrected and
        // spellchecked — three ways for the keyboard to change what was typed.
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        // Room for the button, so a long password does not run underneath it.
        // Icon-only, which keeps it narrow enough for a password field sitting
        // in one half of a two-column grid — a "Show" label beside the icon
        // needs more room than a ~220px field has to spare.
        className={`${className ?? ""} pr-10`}
      />

      <button
        type="button"
        onClick={() => setVisible((current) => !current)}
        // Not disabled when the field is: a disabled form still shows a value
        // worth reading. But it is skipped in the tab order, because tabbing
        // from the password field should reach the submit button, not a control
        // that changes nothing about what gets submitted.
        tabIndex={-1}
        aria-controls={inputId}
        aria-pressed={visible}
        aria-label={visible ? "Hide password" : "Show password"}
        title={visible ? "Hide password" : "Show password"}
        className="absolute inset-y-0 right-0 flex items-center rounded-r-lg px-3 text-ink-muted transition-colors hover:text-ink"
      >
        {visible ? <EyeOff /> : <Eye />}
      </button>
    </div>
  );
}

function Eye() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function EyeOff() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 4l16 16"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M9.9 5.8A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3.2 3.9M6.7 7.5A17 17 0 0 0 2.5 12S6 18.5 12 18.5c.9 0 1.7-.1 2.5-.4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9.9 10.1a3 3 0 0 0 4.1 4.2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
