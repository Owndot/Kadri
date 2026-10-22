#!/usr/bin/env bash
# Alle Tests der Erweiterung (Chromium mit geladener Erweiterung aus dist/test). Vorher: node tools/build.js --test
# Streng: eine fehlgeschlagene Prüfung, ein Absturz oder ein Test ohne Ergebniszeile = Fehlercode.
# Ohne Bildschirm (Server/CI) läuft Chromium unter xvfb-run (Erweiterungen brauchen ein sichtbares Fenster).
cd "$(dirname "$0")"
run() { if [ -z "$DISPLAY" ] && command -v xvfb-run >/dev/null; then xvfb-run -a "$@"; else "$@"; fi; }
mkdir -p out
bad=()
for t in ${TESTS:-test_*.py}; do
  log="out/${t%.py}.log"; t0=$SECONDS
  timeout -k 15 300 bash -c "$(declare -f run); run python3 -u '$t'" > "$log" 2>&1; code=$?
  dur="$((SECONDS - t0))s"
  res=$(grep -E '^ERGEBNIS' "$log" | tail -1); nfail=$(grep -cE '^\s*FAIL' "$log"); why=''
  if [ "$code" = 124 ] || [ "$code" = 137 ]; then why='Zeit überschritten'
  elif [ "$code" != 0 ]; then why='Absturz: '$(grep -E '^[A-Za-z_.]+(Error|Exception)' "$log" | tail -1 | cut -c1-90)
  elif [ -z "$res" ]; then why='keine Ergebniszeile'
  elif [ "$nfail" -gt 0 ]; then why="$nfail Prüfung(en) fehlgeschlagen"
  elif [[ $res =~ ([0-9]+)\ von\ ([0-9]+) ]] && [ "${BASH_REMATCH[1]}" != "${BASH_REMATCH[2]}" ]; then why="nur ${BASH_REMATCH[1]} von ${BASH_REMATCH[2]}"
  fi
  if [ -n "$why" ]; then bad+=("$t"); printf '%-20s %5s FEHLER – %s\n' "$t" "$dur" "$why"; grep -E '^\s*FAIL' "$log" | head -5 | cut -c1-200 | sed 's/^/      /'
  else printf '%-20s %5s ok   %s\n' "$t" "$dur" "${res#ERGEBNIS: }"; fi
done
echo
if [ ${#bad[@]} -gt 0 ]; then echo "GESAMT: ${#bad[@]} Test(s) mit Fehlern: ${bad[*]}"; exit 1; fi
echo "GESAMT: alles bestanden"
