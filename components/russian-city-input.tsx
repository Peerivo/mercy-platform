"use client";

import { useId, useMemo, useState } from "react";
import type {
  ChangeEvent,
  FocusEvent,
  InputHTMLAttributes,
  KeyboardEvent,
  MouseEvent,
} from "react";

import { RUSSIAN_LOCALITIES } from "@/lib/russian-localities";

type RussianCityInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "list" | "value"
>;

const MAX_SUGGESTIONS = 8;

function normalize(value: string) {
  return value.trim().toLocaleLowerCase("ru-RU").replace(/ё/g, "е");
}

export function RussianCityInput({
  id,
  autoComplete,
  defaultValue,
  onBlur,
  onChange,
  onFocus,
  onKeyDown,
  ...props
}: RussianCityInputProps) {
  const generatedId = useId();
  const safeId = generatedId.replace(/:/g, "");
  const inputId = id ?? `russian-locality-${safeId}`;
  const listId = `${inputId}-suggestions`;

  const [value, setValue] = useState(() => String(defaultValue ?? ""));
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const suggestions = useMemo(() => {
    const query = normalize(value);

    if (query.length < 2) {
      return [];
    }

    const startsWith = RUSSIAN_LOCALITIES.filter((locality) =>
      normalize(locality.name).startsWith(query),
    );

    if (startsWith.length >= MAX_SUGGESTIONS) {
      return startsWith.slice(0, MAX_SUGGESTIONS);
    }

    const startsWithKeys = new Set(
      startsWith.map(
        (locality) =>
          `${locality.name}\u0000${locality.region}\u0000${locality.kind}`,
      ),
    );

    const contains = RUSSIAN_LOCALITIES.filter(
      (locality) =>
        normalize(locality.name).includes(query) &&
        !startsWithKeys.has(
          `${locality.name}\u0000${locality.region}\u0000${locality.kind}`,
        ),
    );

    return [...startsWith, ...contains].slice(0, MAX_SUGGESTIONS);
  }, [value]);

  const visible = isOpen && suggestions.length > 0;

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    setValue(event.target.value);
    setIsOpen(true);
    setActiveIndex(-1);
    onChange?.(event);
  }

  function handleFocus(event: FocusEvent<HTMLInputElement>) {
    setIsOpen(true);
    onFocus?.(event);
  }

  function handleBlur(event: FocusEvent<HTMLInputElement>) {
    setIsOpen(false);
    setActiveIndex(-1);
    onBlur?.(event);
  }

  function chooseLocality(localityName: string) {
    setValue(localityName);
    setIsOpen(false);
    setActiveIndex(-1);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (visible && event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) =>
        current >= suggestions.length - 1 ? 0 : current + 1,
      );
      return;
    }

    if (visible && event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) =>
        current <= 0 ? suggestions.length - 1 : current - 1,
      );
      return;
    }

    if (visible && event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      chooseLocality(suggestions[activeIndex].name);
      return;
    }

    if (event.key === "Escape") {
      setIsOpen(false);
      setActiveIndex(-1);
    }

    onKeyDown?.(event);
  }

  function handleOptionMouseDown(
    event: MouseEvent<HTMLLIElement>,
    localityName: string,
  ) {
    event.preventDefault();
    chooseLocality(localityName);
  }

  return (
    <div className="russian-city-autocomplete">
      <input
        {...props}
        id={inputId}
        value={value}
        autoComplete={autoComplete ?? "off"}
        role="combobox"
        aria-autocomplete="list"
        aria-controls={listId}
        aria-expanded={visible}
        aria-activedescendant={
          visible && activeIndex >= 0
            ? `${listId}-option-${activeIndex}`
            : undefined
        }
        onBlur={handleBlur}
        onChange={handleChange}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
      />

      {visible && (
        <ul
          className="russian-city-suggestions"
          id={listId}
          role="listbox"
          aria-label="Населённые пункты России"
        >
          {suggestions.map((locality, index) => (
            <li
              id={`${listId}-option-${index}`}
              key={`${locality.name}-${locality.region}-${locality.kind}-${index}`}
              className={
                index === activeIndex
                  ? "russian-city-option is-active"
                  : "russian-city-option"
              }
              role="option"
              aria-selected={index === activeIndex}
              onMouseDown={(event) =>
                handleOptionMouseDown(event, locality.name)
              }
              onMouseEnter={() => setActiveIndex(index)}
            >
              <span className="russian-city-name">{locality.name}</span>
              <span className="russian-city-region">
                {locality.kind} · {locality.region}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
