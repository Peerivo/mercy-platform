"use client";

import { useId } from "react";
import type { InputHTMLAttributes } from "react";

import { RUSSIAN_CITIES } from "@/lib/russian-cities";

type RussianCityInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "list">;

export function RussianCityInput({
  id,
  autoComplete,
  ...props
}: RussianCityInputProps) {
  const generatedId = useId();
  const safeId = generatedId.replace(/:/g, "");
  const inputId = id ?? `russian-city-${safeId}`;
  const listId = `${inputId}-suggestions`;

  return (
    <>
      <input
        {...props}
        id={inputId}
        list={listId}
        autoComplete={autoComplete ?? "off"}
      />
      <datalist id={listId}>
        {RUSSIAN_CITIES.map((city, index) => (
          <option
            key={`${city.name}-${city.region}-${index}`}
            value={city.name}
            label={city.region}
          />
        ))}
      </datalist>
    </>
  );
}
