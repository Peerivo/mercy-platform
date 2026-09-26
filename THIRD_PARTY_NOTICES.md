# Third-party notices

## Russian city directory

`lib/russian-cities.ts` is derived from the `city.csv` dataset in
[hflabs/city](https://github.com/hflabs/city).

Source data is licensed under the Creative Commons Attribution-ShareAlike 4.0
International License (CC BY-SA 4.0):
https://creativecommons.org/licenses/by-sa/4.0/

Changes made for Mercy: only city name and region were retained, region labels
were normalized for display, and records were sorted for autocomplete use.

## Russian urban-type settlements

`lib/russian-urban-settlements.ts` is a generated snapshot of the table
«Посёлки городского типа России» from Russian Wikipedia, integrated on
2026-09-20. Rows explicitly marked there as former urban-type settlements are
excluded. Mercy retains only the locality name, region and population value.

Source page:
https://ru.wikipedia.org/wiki/Посёлки_городского_типа_России

Wikipedia text is available under CC BY-SA 4.0 (and, where applicable, GFDL).
The generated locality data is kept separate from the application logic and its
source is documented here.

The Mercy application code remains under its repository license (GNU
AGPL-3.0). Runtime verification against GAR/FIAS does not copy the GAR database
into this repository.
