#!/usr/bin/env python3
# S3c: erzeugt die Grenzfall-MPDs für die Querprüfung des Fingerabdrucks kadri-dash-fp/1 (tests/web/dash/fp/x).
# Die erwarteten Werte (fp-v1-crosscheck.tsv) berechnet der Helper (DashFingerprint); Kadri muss sie exakt reproduzieren.
#   python3 tools/dash-fp-variants.py tests/web/dash/fp/x
import os, sys
OUT = sys.argv[1]
NS = 'urn:mpeg:dash:schema:mpd:2011'
def mpd(body, attrs='type="static" mediaPresentationDuration="PT20S"', head='<?xml version="1.0" encoding="UTF-8"?>\n', extra_ns=''):
    return head + '<MPD xmlns="%s"%s %s>%s</MPD>\n' % (NS, extra_ns, attrs, body)
TPL = '<SegmentTemplate timescale="1000" duration="4000" initialization="$RepresentationID$/init.mp4" media="$RepresentationID$/$Number$.m4s"/>'
V = '<AdaptationSet mimeType="video/mp4" codecs="avc1.4d401e" contentType="video">' + TPL + '<Representation id="v1" bandwidth="500000" width="640" height="360"/></AdaptationSet>'
A = '<AdaptationSet mimeType="audio/mp4" codecs="mp4a.40.2" contentType="audio" lang="de">' + TPL + '<Representation id="a1" bandwidth="64000"/></AdaptationSet>'
P = lambda inner, pattrs='': '<Period%s>%s</Period>' % (pattrs, inner)
cases = {
 'base-av.mpd': mpd(P(V + A)),
 'comment-cdata.mpd': mpd('<!-- c --><BaseURL><![CDATA[media/]]></BaseURL>' + P(V + A)),
 'entity-amp.mpd': mpd(P(V.replace('$Number$.m4s', '$Number$.m4s?a=1&amp;b=2') + A)),
 'prefix-ns.mpd': '<?xml version="1.0"?>\n<d:MPD xmlns:d="%s" type="static" mediaPresentationDuration="PT20S"><d:Period><d:AdaptationSet mimeType="video/mp4" codecs="avc1.4d401e"><d:SegmentTemplate timescale="1000" duration="4000" initialization="i.mp4" media="$Number$.m4s"/><d:Representation id="v" bandwidth="1"/></d:AdaptationSet></d:Period></d:MPD>\n' % NS,
 'label-ws.mpd': mpd(P(V.replace('<SegmentTemplate', '<Label>\n\t Haupt  Spur \n</Label><SegmentTemplate', 1) + A)),
 'label-nbsp.mpd': mpd(P(V.replace('<SegmentTemplate', '<Label> Spur </Label><SegmentTemplate', 1) + A)),
 'kid-cenc.mpd': mpd(P(V.replace('<SegmentTemplate', '<ContentProtection xmlns:cenc="urn:mpeg:cenc:2013" schemeIdUri="urn:mpeg:dash:mp4protection:2011" value="cenc" cenc:default_KID="00000000-0000-0000-0000-000000000001"/><SegmentTemplate', 1) + A)),
 'kid-plain.mpd': mpd(P(V.replace('<SegmentTemplate', '<ContentProtection schemeIdUri="urn:x" value="v" default_KID="k"/><SegmentTemplate', 1) + A)),
 'cp-period.mpd': mpd('<Period><ContentProtection schemeIdUri="urn:x"/>' + V + A + '</Period>'),
 'bandwidth-fmt.mpd': mpd(P(V.replace('$RepresentationID$/$Number$.m4s', 'b$Bandwidth%08d$/$Number%05d$.m4s') + A)),
 'dollar-escape.mpd': mpd(P(V.replace('$RepresentationID$/$Number$.m4s', 'x$$y/$Number$.m4s') + A)),
 'id-nines.mpd': mpd(P(V.replace('id="v1"', 'id="v9999"') + A), ),
 'base-nines.mpd': mpd('<BaseURL>https://cdn.example/999999/</BaseURL>' + P(V + A)),
 'kadri-token-id.mpd': mpd(P(V.replace('id="v1"', 'id="KADRIIDXTOKEN9Q"') + A)),
 'port-ip.mpd': mpd('<BaseURL>http://192.168.0.10:8080/a/</BaseURL>' + P(V + A)),
 'port-default.mpd': mpd('<BaseURL>HTTPS://CDN.Example:443/A/</BaseURL>' + P(V + A)),
 'query-base.mpd': mpd('<BaseURL>https://cdn.example/r/?s=1</BaseURL>' + P('<BaseURL>p/</BaseURL>' + V + A)),
 'dotdot.mpd': mpd('<BaseURL>a/b/../c/./</BaseURL>' + P(V + A)),
 'timeline.mpd': mpd(P('<AdaptationSet mimeType="video/mp4" codecs="avc1.4d401e"><SegmentTemplate timescale="90000" initialization="i.mp4" media="$Time$.m4s"><SegmentTimeline><S d="360000" r="2"/><S d="360000"/><S t="1440000" d="360000" r="-1"/></SegmentTimeline></SegmentTemplate><Representation id="v" bandwidth="1"/></AdaptationSet>' + A)),
 'timeline-pto.mpd': mpd(P('<AdaptationSet mimeType="video/mp4" codecs="avc1.4d401e"><SegmentTemplate timescale="1000" presentationTimeOffset="500" startNumber="7" initialization="i.mp4" media="$Number%03d$.m4s"><SegmentTimeline><S t="500" d="4000" r="4"/></SegmentTimeline></SegmentTemplate><Representation id="v" bandwidth="1"/></AdaptationSet>' + A)),
 'list-ranges.mpd': mpd(P('<AdaptationSet mimeType="video/mp4" codecs="avc1.4d401e"><Representation id="v" bandwidth="1"><SegmentList timescale="1000" duration="10000"><Initialization sourceURL="v.mp4" range="0-99"/><SegmentURL media="v.mp4" mediaRange="100-199"/><SegmentURL mediaRange="200-299"/></SegmentList></Representation></AdaptationSet>' + A)),
 'list-inherit.mpd': mpd(P('<AdaptationSet mimeType="video/mp4" codecs="avc1.4d401e"><SegmentList timescale="1000" duration="10000"><Initialization sourceURL="init.mp4"/><SegmentURL media="s1.m4s"/><SegmentURL media="s2.m4s"/></SegmentList><Representation id="v1" bandwidth="1"><BaseURL>v1/</BaseURL></Representation><Representation id="v2" bandwidth="2"><BaseURL>v2/</BaseURL></Representation></AdaptationSet>' + A)),
 'unsupported-attr.mpd': mpd(P(V.replace('<SegmentTemplate ', '<SegmentTemplate indexRange="0-10" endNumber="5" ', 1) + A)),
 'unsupported-kid.mpd': mpd(P(V.replace('/>', '><RepresentationIndex sourceURL="x"/></SegmentTemplate>', 1) + A)),
 'durations.mpd': mpd(P(V + A, ' id="p1" start="PT0.000S" duration="P1DT2H3M4.5000S"'), attrs='type="static" mediaPresentationDuration="PT0S"'),
 'role-acc-ach.mpd': mpd(P(V + A.replace('<SegmentTemplate', '<Role schemeIdUri="urn:mpeg:dash:role:2011" value="main"/><Accessibility schemeIdUri="urn:x" value="y"/><AudioChannelConfiguration schemeIdUri="urn:mpeg:dash:23003:3:audio_channel_configuration:2011" value="2"/><EssentialProperty schemeIdUri="urn:e"/><SupplementalProperty schemeIdUri="urn:s" value="a|b"/><SegmentTemplate', 1))),
 'subrep-component.mpd': mpd(P(V.replace('<Representation id="v1" bandwidth="500000" width="640" height="360"/>', '<ContentComponent id="1" contentType="video"/><Representation id="v1" bandwidth="500000" width="640" height="360" frameRate="25" audioSamplingRate="48000"><SubRepresentation level="0"/></Representation>') + A)),
 'no-type.mpd': mpd(P(V + A), attrs='mediaPresentationDuration="PT20S"'),
 'dynamic.mpd': mpd(P(V + A), attrs='type="dynamic" availabilityStartTime="1970-01-01T00:00:00Z"'),
 'multi-period.mpd': mpd(P(V + A, ' id="a" duration="PT10S"') + P(V + A, ' id="b"')),
 'foreign-ext.mpd': mpd(P(V.replace('<SegmentTemplate', '<x:Ext xmlns:x="urn:vendor"><x:Y a="1"/></x:Ext><SegmentTemplate x:z="1" xmlns:x="urn:vendor"', 1) + A)),
 'number-leading-zero.mpd': mpd(P(V.replace('timescale="1000"', 'timescale=" 0001000 "') + A)),
 'bw-absent.mpd': mpd(P(V.replace(' bandwidth="500000"', '') + A)),
 'newline-attr.mpd': mpd(P(V.replace('codecs="avc1.4d401e"', 'codecs="avc1.4d401e&#10;x"') + A)),
 'pipe-backslash.mpd': mpd(P(V.replace('id="v1"', 'id="v\\1|x"').replace('$RepresentationID$', 'r') + A)),
 'dash-literal.mpd': mpd(P(V.replace('<SegmentTemplate', '<Label>-</Label><SegmentTemplate', 1) + A)),
 'unicode-label.mpd': mpd(P(V.replace('<SegmentTemplate', '<Label>Ünïcödé 😀 日本</Label><SegmentTemplate', 1) + A)),
 # Fälle, die der Helfer fatal ablehnt (beide Seiten: kein Abdruck)
 'bad-doctype.mpd': '<?xml version="1.0"?>\n<!DOCTYPE MPD>' + mpd(P(V + A), head=''),
 'bad-element-decl.mpd': mpd(P(V + A)).replace('<MPD', '<!-- ok --><!ELEMENT x ANY><MPD', 1),
 'bad-xlink.mpd': mpd(P(V + A, ' xlink:href="http://x/p" xmlns:xlink="http://www.w3.org/1999/xlink"')),
 'bad-xinclude.mpd': mpd(P(V + A) + '<xi:include href="x" xmlns:xi="http://www.w3.org/2001/XInclude"/>'),
 'bad-foreign-dash-name.mpd': mpd(P(V + A) + '<x:Period xmlns:x="urn:other"/>'),
 'bad-two-baseurl.mpd': mpd('<BaseURL>a/</BaseURL><BaseURL>b/</BaseURL>' + P(V + A)),
 'bad-baseurl-attr.mpd': mpd('<BaseURL foo="1">a/</BaseURL>' + P(V + A)),
 'bad-number.mpd': mpd(P(V.replace('timescale="1000"', 'timescale="1e3"') + A)),
 'bad-duration-years.mpd': mpd(P(V + A), attrs='type="static" mediaPresentationDuration="P1Y"'),
 'bad-template.mpd': mpd(P(V.replace('$Number$', '$SubNumber$') + A)),
 'bad-template-idfmt.mpd': mpd(P(V.replace('$RepresentationID$/', '$RepresentationID%02d$/') + A)),
 'bad-uri-brace.mpd': mpd('<BaseURL>a{b}/</BaseURL>' + P(V + A)),
 'bad-uri-pct2e.mpd': mpd('<BaseURL>%2e%2e/a/</BaseURL>' + P(V + A)),
 'bad-uri-host.mpd': mpd('<BaseURL>http://127.1/a/</BaseURL>' + P(V + A)),
 'bad-mixed.mpd': mpd(P(V.replace('<Representation id="v1" bandwidth="500000" width="640" height="360"/>', '<Representation id="v1" bandwidth="1"><SegmentList><SegmentURL media="a"/></SegmentList></Representation>') + A)),
 'bad-s-attr.mpd': mpd(P('<AdaptationSet mimeType="video/mp4"><SegmentTemplate timescale="1" media="$Time$" initialization="i"><SegmentTimeline><S d="1" n="3"/></SegmentTimeline></SegmentTemplate><Representation id="v" bandwidth="1"/></AdaptationSet>')),
 'bad-s-outside.mpd': mpd(P('<AdaptationSet><S d="1"/></AdaptationSet>')),
 'bad-encoding.mpd': mpd(P(V + A), head='<?xml version="1.0" encoding="ISO-8859-1"?>\n'),
 'bad-bandwidth.mpd': mpd(P(V.replace('bandwidth="500000"', 'bandwidth="2000000000"') + A)),
 'bad-timescale0.mpd': mpd(P(V.replace('timescale="1000"', 'timescale="0"') + A)),
 'bad-tl-and-duration.mpd': mpd(P('<AdaptationSet mimeType="video/mp4"><SegmentTemplate timescale="1" duration="4" media="$Number$" initialization="i"><SegmentTimeline><S d="1"/></SegmentTimeline></SegmentTemplate><Representation id="v" bandwidth="1"/></AdaptationSet>')),
}
for n, t in cases.items():
    open(os.path.join(OUT, n), 'w', encoding='utf-8', newline='').write(t)
print(len(cases))
