import { useEffect, useRef, type ReactNode } from 'react';
import { X, ArrowUpRight, Inbox } from 'lucide-react';
import type { Priority } from '../../shared/domain.ts';
export const time = (v: string) =>
  new Date(v).toLocaleTimeString('en-ZA', {
    timeZone: 'Africa/Johannesburg',
    hour: '2-digit',
    minute: '2-digit',
  });
export const date = (v: string) =>
  new Date(v).toLocaleDateString('en-ZA', {
    timeZone: 'Africa/Johannesburg',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
export const inputTime = (v = new Date().toISOString()) =>
  new Date(+new Date(v) + 7200000).toISOString().slice(0, 16);
export const fromInput = (v: string) => new Date(`${v}:00+02:00`).toISOString();
export function Brand() {
  return (
    <svg
      className="brand-lockup"
      viewBox="200 255 1280 425"
      role="img"
      aria-label="SurgiLog — The trusted clinical register"
    >
      <image href="/SurgiLog Clinical Register Logo.png" width="1677" height="938" />
    </svg>
  );
}
export function PriorityBadge({ value }: { value: Priority }) {
  return (
    <span className={`badge priority-${value}`}>
      {value}
      <span>{value === 'P1' ? '≤30 days' : value === 'P2' ? '31–90 days' : '91–365 days'}</span>
    </span>
  );
}
export function Status({ value }: { value: string }) {
  return (
    <span className={`status status-${value.toLowerCase().replaceAll(' ', '-')}`}>
      <i />
      {value}
    </span>
  );
}
export function Empty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty">
      <Inbox size={30} />
      <h3>{title}</h3>
      <p>{detail}</p>
    </div>
  );
}
export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      className={`modal ${wide ? 'wide' : ''}`}
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="modal-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Metric({
  label,
  value,
  detail,
  icon,
  tone = 'blue',
}: {
  label: string;
  value: ReactNode;
  detail: string;
  icon: ReactNode;
  tone?: string;
}) {
  return (
    <div className="metric">
      <div className="metric-top">
        <span>{label}</span>
        <div className={`metric-icon ${tone}`}>{icon}</div>
      </div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}
export function SectionTitle({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="section-title">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h2>{title}</h2>
      </div>
      {children}
    </div>
  );
}
export function LinkButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button className="text-button" onClick={onClick}>
      {children}
      <ArrowUpRight size={15} />
    </button>
  );
}
