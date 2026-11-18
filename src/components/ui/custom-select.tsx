"use client";

import {
  Children,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CustomSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  hint?: string;
}

interface CustomSelectProps {
  id?: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  options?: CustomSelectOption[];
  children?: ReactNode;
  onChange?: (event: { target: { value: string; name?: string } }) => void;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  variant?: "field" | "bar";
  align?: "left" | "right";
  placeholder?: string;
  "aria-label"?: string;
}

function parseOptionsFromChildren(children: ReactNode): CustomSelectOption[] {
  const result: CustomSelectOption[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement<{
      value?: string | number;
      disabled?: boolean;
      children?: ReactNode;
    }>(child)) {
      return;
    }
    if (child.type === "option") {
      const labelText = Children.toArray(child.props.children)
        .map((node) => (node == null ? "" : String(node)))
        .join("")
        .trim();
      const val =
        child.props.value !== undefined ? String(child.props.value) : labelText;
      result.push({
        value: val,
        label: labelText || val,
        disabled: Boolean(child.props.disabled),
      });
    }
  });
  return result;
}

export function CustomSelect({
  id,
  name,
  value,
  defaultValue,
  options: explicitOptions,
  children,
  onChange,
  onValueChange,
  disabled = false,
  required = false,
  className,
  variant = "field",
  align = "left",
  placeholder = "Select…",
  "aria-label": ariaLabel,
}: CustomSelectProps) {
  const parsedOptions = useMemo(
    () => explicitOptions ?? parseOptionsFromChildren(children),
    [explicitOptions, children],
  );

  const isControlled = value !== undefined;
  const fallbackValue = useMemo(() => {
    if (defaultValue !== undefined) return String(defaultValue);
    return parsedOptions[0]?.value ?? "";
  }, [defaultValue, parsedOptions]);

  const [internalValue, setInternalValue] = useState(fallbackValue);

  useEffect(() => {
    if (!isControlled && defaultValue !== undefined) {
      setInternalValue(String(defaultValue));
    }
  }, [defaultValue, isControlled]);

  const currentValue = isControlled ? String(value) : internalValue;
  const currentOption =
    parsedOptions.find((opt) => opt.value === currentValue) ||
    parsedOptions.find((opt) => opt.value === "") ||
    null;

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [coords, setCoords] = useState<{
    top: number;
    left: number;
    minWidth: number;
    maxWidth: number;
    maxHeight: number;
    openUp: boolean;
  } | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const [portalTarget, setPortalTarget] = useState<Element | null>(null);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const spaceBelow = vh - rect.bottom - 12;
    const spaceAbove = rect.top - 12;
    const openUp = spaceBelow < 210 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(
      140,
      Math.min(280, openUp ? spaceAbove : spaceBelow),
    );
    const minWidth = Math.max(rect.width, variant === "bar" ? 200 : rect.width);
    const maxWidth = Math.min(360, vw - 16);
    const estimatedWidth = Math.min(Math.max(rect.width, minWidth), maxWidth);
    let left = align === "right" ? rect.right - estimatedWidth : rect.left;
    if (left + estimatedWidth > vw - 8) left = vw - 8 - estimatedWidth;
    if (left < 8) left = 8;

    setCoords({
      top: openUp ? rect.top - 6 : rect.bottom + 6,
      left,
      minWidth: Math.min(minWidth, maxWidth),
      maxWidth,
      maxHeight,
      openUp,
    });
    setPortalTarget(trigger.closest("dialog") ?? document.body);
  }, [align, variant]);

  const selectValue = useCallback(
    (next: string) => {
      if (!isControlled) setInternalValue(next);
      onValueChange?.(next);
      onChange?.({ target: { value: next, name } });
      setOpen(false);
      triggerRef.current?.focus();
    },
    [isControlled, name, onChange, onValueChange],
  );

  useEffect(() => {
    if (!open) return;
    updatePosition();
    const currentIdx = parsedOptions.findIndex(
      (opt) => opt.value === currentValue && !opt.disabled,
    );
    const firstEnabled = parsedOptions.findIndex((opt) => !opt.disabled);
    setActiveIndex(currentIdx >= 0 ? currentIdx : firstEnabled);

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    };
    const onResize = () => updatePosition();
    const onScroll = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      updatePosition();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, updatePosition, parsedOptions, currentValue]);

  const moveFocus = (delta: 1 | -1) => {
    if (!parsedOptions.length) return;
    let idx = activeIndex;
    for (let i = 0; i < parsedOptions.length; i++) {
      idx = (idx + delta + parsedOptions.length) % parsedOptions.length;
      if (!parsedOptions[idx].disabled) {
        setActiveIndex(idx);
        return;
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      return;
    }
    if (e.key === "Tab") {
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveFocus(1);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      moveFocus(-1);
      return;
    }
    if (e.key === "Home") {
      e.preventDefault();
      const first = parsedOptions.findIndex((opt) => !opt.disabled);
      if (first >= 0) setActiveIndex(first);
      return;
    }
    if (e.key === "End") {
      e.preventDefault();
      for (let i = parsedOptions.length - 1; i >= 0; i--) {
        if (!parsedOptions[i].disabled) {
          setActiveIndex(i);
          break;
        }
      }
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const chosen = parsedOptions[activeIndex];
      if (chosen && !chosen.disabled) selectValue(chosen.value);
    }
  };

  return (
    <div
      className={cn(
        "cselect",
        variant === "bar" ? "cselect-bar" : "cselect-field",
        open && "is-open",
        disabled && "is-disabled",
        className,
      )}
    >
      {name && (
        <input
          type="hidden"
          name={name}
          value={currentValue}
          required={required}
        />
      )}
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        disabled={disabled}
        className="cselect-trigger"
        onClick={() => {
          if (!disabled) setOpen((v) => !v);
        }}
        onKeyDown={handleKeyDown}
      >
        <span
          className={cn(
            "cselect-value",
            !currentOption?.value && "is-placeholder",
          )}
        >
          {currentOption ? currentOption.label : placeholder}
        </span>
        <ChevronDown size={14} className="cselect-chevron" aria-hidden="true" />
      </button>

      {open &&
        coords &&
        portalTarget &&
        createPortal(
          <div
            ref={menuRef}
            id={listboxId}
            role="listbox"
            aria-label={ariaLabel}
            className={cn("cselect-menu", coords.openUp && "is-up")}
            style={{
              position: "fixed",
              top: coords.top,
              left: coords.left,
              minWidth: coords.minWidth,
              maxWidth: coords.maxWidth,
              maxHeight: coords.maxHeight,
              transform: coords.openUp ? "translateY(-100%)" : undefined,
            }}
          >
            {parsedOptions.length ? (
              parsedOptions.map((opt, idx) => {
                const selected = opt.value === currentValue;
                const active = idx === activeIndex;
                return (
                  <button
                    key={`${opt.value}-${idx}`}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    disabled={opt.disabled}
                    className={cn(
                      "cselect-option",
                      selected && "is-selected",
                      active && "is-active",
                    )}
                    onMouseEnter={() => {
                      if (!opt.disabled) setActiveIndex(idx);
                    }}
                    onClick={() => {
                      if (!opt.disabled) selectValue(opt.value);
                    }}
                  >
                    <span className="cselect-option-text">
                      <span className="cselect-option-label">{opt.label}</span>
                      {opt.hint && (
                        <small className="cselect-option-hint">
                          {opt.hint}
                        </small>
                      )}
                    </span>
                    {selected && (
                      <Check
                        size={13}
                        className="cselect-check"
                        aria-hidden="true"
                      />
                    )}
                  </button>
                );
              })
            ) : (
              <div className="cselect-empty">No options available</div>
            )}
          </div>,
          portalTarget,
        )}
    </div>
  );
}

interface CustomMultiSelectProps {
  name: string;
  options: CustomSelectOption[];
  defaultSelected?: string[];
  emptyText?: string;
  "aria-label"?: string;
}

export function CustomMultiSelect({
  name,
  options,
  defaultSelected = [],
  emptyText = "No items available",
  "aria-label": ariaLabel,
}: CustomMultiSelectProps) {
  const [selected, setSelected] = useState<string[]>(defaultSelected);

  function toggle(value: string) {
    setSelected((prev) =>
      prev.includes(value) ? prev.filter((x) => x !== value) : [...prev, value],
    );
  }

  return (
    <div className="cmulti" role="group" aria-label={ariaLabel}>
      {selected.map((val) => (
        <input key={val} type="hidden" name={name} value={val} />
      ))}
      {options.length ? (
        options.map((opt) => {
          const active = selected.includes(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              role="checkbox"
              aria-checked={active}
              disabled={opt.disabled}
              className={cn("cmulti-item", active && "is-selected")}
              onClick={() => toggle(opt.value)}
            >
              <span className="cmulti-box" aria-hidden="true">
                {active && <Check size={11} />}
              </span>
              <span className="cmulti-label">{opt.label}</span>
            </button>
          );
        })
      ) : (
        <span className="cmulti-empty">{emptyText}</span>
      )}
    </div>
  );
}
