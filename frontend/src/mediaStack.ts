import { createElement, type ReactNode } from "react";
import {
  IconCamera,
  IconMediaBooks,
  IconMediaFiles,
  IconMediaGames,
  IconMediaHobbies,
  IconMediaMovies,
  IconMediaMusic,
  IconMediaSeries,
} from "./components/MenuIcons";

/** Display name with Stack suffix (Series → SerieStack, Movies → MovieStack). */
export function toStackName(label: string): string {
  const trimmed = label.trim();
  const lower = trimmed.toLowerCase();
  if (lower === "photos") return "PhotoStack";
  if (lower === "files") return "FileStack";
  if (lower === "hobbies") return "HobbyStack";
  const base = trimmed.endsWith("s") || trimmed.endsWith("S")
    ? trimmed.slice(0, -1)
    : trimmed;
  return `${base}Stack`;
}

/** Split ``MusicStack`` → ``{ module: "Music", stack: "Stack" }`` for styled chrome. */
export function stackNameParts(label: string): { module: string; stack: string } {
  const full = toStackName(label);
  if (full.endsWith("Stack") && full.length > 5) {
    return { module: full.slice(0, -5), stack: "Stack" };
  }
  return { module: full, stack: "Stack" };
}

const MEDIA_ICONS: Record<string, typeof IconMediaMusic> = {
  music: IconMediaMusic,
  series: IconMediaSeries,
  movies: IconMediaMovies,
  books: IconMediaBooks,
  games: IconMediaGames,
  photos: IconCamera,
  files: IconMediaFiles,
  hobbies: IconMediaHobbies,
};

export function mediaTypeIcon(kind: string): ReactNode {
  const Icon = MEDIA_ICONS[kind] ?? IconMediaMusic;
  return createElement(Icon);
}
