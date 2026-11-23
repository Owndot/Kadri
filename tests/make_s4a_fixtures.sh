#!/usr/bin/env bash
# S4a – zusätzliche DASH-Fixtures für den Player-Matrix-Prüfstand (tests/s4a_dash_player_matrix.py), erzeugt in OUT
# (nicht eingecheckt). Nur synthetisches Material (Testbild + Sinuston), kein DRM.
#   sb/  H.264 + AAC-LC aus der S3d-Fixture, ohne Neukodierung (-c copy): eine Datei je Darstellung, SegmentList mit
#        mediaRange (Byte-Bereiche) – „Einzeldatei“-Adressierung
#   wm/  VP9 + Opus in WebM, SegmentTemplate $Number%05d$ + SegmentTimeline (ffmpeg -dash_segment_type webm)
#   vm/  VP9 + Opus in fMP4 (vp09 / Opus-Box), sonst wie wm/
# Aufruf: tests/make_s4a_fixtures.sh OUT     (ffmpeg mit libvpx-vp9 und libopus; geprüft mit ffmpeg 6.1.1)
set -euo pipefail
OUT=${1:?Zielordner}
SRC=$(cd "$(dirname "$0")" && pwd)/web/public/s3d-dash
mkdir -p "$OUT/sb" "$OUT/wm" "$OUT/vm" "$OUT/tmp"
for r in 1 2; do cat "$SRC/init-$r.m4s" "$SRC"/chunk-$r-*.m4s > "$OUT/tmp/rep$r.mp4"; done
ff() { ffmpeg -hide_banner -loglevel error -y "$@"; }
ff -i "$OUT/tmp/rep1.mp4" -i "$OUT/tmp/rep2.mp4" -map 0:v -map 1:a -c copy -fflags +bitexact \
   -f dash -single_file 1 -seg_duration 4 -use_template 0 -use_timeline 0 "$OUT/sb/manifest.mpd"
SYN=(-f lavfi -i "testsrc2=s=640x360:r=25:d=20" -f lavfi -i "sine=f=1000:sample_rate=48000:d=20"
     -c:v libvpx-vp9 -b:v 400k -deadline realtime -cpu-used 8 -threads 1 -g 50 -keyint_min 50 -c:a libopus -b:a 64k -fflags +bitexact
     -f dash -seg_duration 4 -use_template 1 -use_timeline 1)
ff "${SYN[@]}" -dash_segment_type webm -init_seg_name 'init-$RepresentationID$.webm' -media_seg_name 'chunk-$RepresentationID$-$Number%05d$.webm' "$OUT/wm/manifest.mpd"
ff "${SYN[@]}" -dash_segment_type mp4 -init_seg_name 'init-$RepresentationID$.m4s' -media_seg_name 'chunk-$RepresentationID$-$Number%05d$.m4s' "$OUT/vm/manifest.mpd"
rm -rf "$OUT/tmp"
(cd "$OUT" && find sb wm vm -type f | sort | xargs sha256sum > SHA256SUMS)
echo "OK $OUT"
