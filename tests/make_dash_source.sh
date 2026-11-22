#!/usr/bin/env bash
# S3c: selbst erzeugte, bindbare DASH-Testquelle (fMP4, H.264 Main 180p/360p + AAC-LC, 20 s, 4-s-Stücke, SegmentTimeline,
# $Number%05d$) – dieselbe Form wie die Fixture des Helpers (tests/java/dashdl/make-dash-fixtures.sh, avc/). Reproduzierbar
# (bitexact). Nur für Tests; nichts davon wird ausgeliefert.
#   bash tests/make_dash_source.sh OUT
set -euo pipefail
OUT="${1:?output dir}"
rm -rf "$OUT"; mkdir -p "$OUT"
V="testsrc2=size=640x360:rate=25,drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='eq(mod(n\,50)\,0)',format=yuv420p"
A="aevalsrc=exprs='if(lt(mod(t\,2)\,0.04)\,0.8*sin(2*PI*1000*t)\,0)':sample_rate=48000:channel_layout=stereo"
( cd "$OUT" && ffmpeg -hide_banner -v error -y -f lavfi -i "$V" -f lavfi -i "$A" -t 20 \
    -map 0:v -map 0:v -map 1:a -filter:v:0 scale=320:180 \
    -c:v libx264 -profile:v main -preset veryfast -crf 30 -g 50 -keyint_min 50 -sc_threshold 0 -bf 2 -threads 1 -flags:v +bitexact \
    -c:a aac -b:a 48k -ac 2 -ar 48000 -flags:a +bitexact -fflags +bitexact -map_metadata -1 \
    -f dash -seg_duration 4 -use_template 1 -use_timeline 1 -adaptation_sets "id=0,streams=v id=1,streams=a" \
    -init_seg_name 'init-$RepresentationID$.m4s' -media_seg_name 'chunk-$RepresentationID$-$Number%05d$.m4s' manifest.mpd )
