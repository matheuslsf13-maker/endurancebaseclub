import { useId } from 'react';
import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

const CONTROL_CLASS =
  'w-full min-h-11 rounded-xl border border-border bg-surface px-3 py-2 text-fg placeholder:text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50';

function describedBy(fieldId: string, hint?: string, error?: string): string | undefined {
  if (error) return `${fieldId}-error`;
  if (hint) return `${fieldId}-hint`;
  return undefined;
}

function FieldMessages({ fieldId, hint, error }: { fieldId: string; hint?: string; error?: string }) {
  if (error) {
    return (
      <p id={`${fieldId}-error`} role="alert" className="text-sm text-danger">
        {error}
      </p>
    );
  }
  if (hint) {
    return (
      <p id={`${fieldId}-hint`} className="text-sm text-muted">
        {hint}
      </p>
    );
  }
  return null;
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
}

export function Input({ label, hint, error, id, className = '', ...rest }: InputProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={fieldId} className="text-sm font-medium text-fg">
        {label}
      </label>
      <input
        id={fieldId}
        className={`${CONTROL_CLASS} ${className}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fieldId, hint, error)}
        {...rest}
      />
      <FieldMessages fieldId={fieldId} hint={hint} error={error} />
    </div>
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  hint?: string;
  error?: string;
  options: SelectOption[];
}

export function Select({ label, hint, error, id, className = '', options, ...rest }: SelectProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={fieldId} className="text-sm font-medium text-fg">
        {label}
      </label>
      <select
        id={fieldId}
        className={`${CONTROL_CLASS} ${className}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fieldId, hint, error)}
        {...rest}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <FieldMessages fieldId={fieldId} hint={hint} error={error} />
    </div>
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  hint?: string;
  error?: string;
}

export function Textarea({ label, hint, error, id, className = '', rows = 3, ...rest }: TextareaProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={fieldId} className="text-sm font-medium text-fg">
        {label}
      </label>
      <textarea
        id={fieldId}
        rows={rows}
        className={`${CONTROL_CLASS} resize-y ${className}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fieldId, hint, error)}
        {...rest}
      />
      <FieldMessages fieldId={fieldId} hint={hint} error={error} />
    </div>
  );
}

export interface CheckboxProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
}

export function Checkbox({ label, hint, error, id, className = '', ...rest }: CheckboxProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={fieldId} className="inline-flex min-h-11 items-center gap-2 text-fg">
        <input
          id={fieldId}
          type="checkbox"
          style={{ accentColor: 'var(--accent)' }}
          className={`h-5 w-5 rounded border-border focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${className}`}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(fieldId, hint, error)}
          {...rest}
        />
        <span className="text-sm">{label}</span>
      </label>
      <FieldMessages fieldId={fieldId} hint={hint} error={error} />
    </div>
  );
}
