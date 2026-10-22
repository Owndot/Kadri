#!/usr/bin/env bash
# Übernimmt das Skript (src/*.js) aus dem Repository des Userscripts „Video-Assistent“ (Owndot/video-assistent-helper).
# Dort wird am Skript gearbeitet; Kadri baut aus genau denselben Teilen (plus ext/ für die Erweiterung).
#   tools/sync-src.sh [Pfad zum anderen Repository]   (Standard: ../video-assistent-helper bzw. ../helfer)
set -e
cd "$(dirname "$0")/.."
SRC="${1:-}"
for c in "$SRC" ../video-assistent-helper ../helfer; do [ -n "$c" ] && [ -d "$c/src" ] && SRC="$c" && break; done
[ -d "$SRC/src" ] || { echo "Repository des Userscripts nicht gefunden – Pfad angeben"; exit 1; }
rm -f src/*.js && cp "$SRC"/src/*.js src/
echo "Übernommen: $(ls src | wc -l) Teile aus $SRC (Skript $(grep -m1 -oP '@version\s+\K\S+' src/010-kopf.js))"
