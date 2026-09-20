"use client";

import { useId, useMemo, useState } from "react";
import type {
  ChangeEvent,
  FocusEvent,
  InputHTMLAttributes,
  KeyboardEvent,
  MouseEvent,
} from "react";

import { RUSSIAN_CITIES } from "@/lib/russian-cities";

type RussianCityInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "list" | "value"
>;

const MAX_SUGGESTIONS = 8;

function normalize(value: string) {
  return value.trim().toLocaleLowerCase("ru-RU");
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
  const inputId = id ?? `russian-city-${safeId}`;
  const listId = `${inputId}-suggestions`;

  const [value, setValue] = useState(() => String(defaultValue ?? ""));
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const suggestions = useMemo(() => {
    const query = normalize(value);

    if (query.length < 2) {
      return [];
    }

    const startsWith = RUSSIAN_CITIES.filter((city) =>
      normalize(city.name).startsWith(query)
    );

    if (startsWith.length >= MAX_SUGGESTIONS) {
      return startsWith.slice(0, MAX_SUGGESTIONS);
    }

    const startsWithKeys = new Set(
      startsWith.map((city) => `${city.name}\u0000${city.region}`)
    );

    const contains = RUSSIAN_CITIES.filter(
      (city) =>
        normalize(city.name).includes(query) &&
        !startsWithKeys.has(`${city.name}\u0000${city.region}`)
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

  function chooseCity(cityName: string) {
    setValue(cityName);
    setIsOpen(false);
    setActiveIndex(-1);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (visible && event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) =>
        current >= suggestions.length - 1 ? 0 : current + 1
      );
      return;
    }

    if (visible && event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) =>
        current <= 0 ? suggestions.length - 1 : current - 1
      );
      return;
    }

    if (visible && event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      chooseCity(suggestions[activeIndex].name);
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
    cityName: string
  ) {
    // Keep focus on the input so selecting an option does not accidentally
    // submit or blur the surrounding form before the value is applied.
    event.preventDefault();
    chooseCity(cityName);
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
          aria-label="Города России"
        >
          {suggestions.map((city, index) => (
            <li
              id={`${listId}-option-${index}`}
              key={`${city.name}-${city.region}-${index}`}
              className={
                index === activeIndex
                  ? "russian-city-option is-active"
                  : "russian-city-option"
              }
              role="option"
              aria-selected={index === activeIndex}
              onMouseDown={(event) => handleOptionMouseDown(event, city.name)}
              onMouseEnter={() => setActiveIndex(index)}
            >
              <span className="russian-city-name">{city.name}</span>
              <span className="russian-city-region">{city.region}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
