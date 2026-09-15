import {
  cpSync,
  existsSync,
  mkdirSync,
} from "node:fs";

if (existsSync("public")) {
  cpSync(
    "public",
    ".next/standalone/public",
    { recursive: true }
  );
}

mkdirSync(
  ".next/standalone/.next",
  { recursive: true }
);

cpSync(
  ".next/static",
  ".next/standalone/.next/static",
  { recursive: true }
);