// Kadri – Service Worker NUR des isolierten Test-Builds dist/channel-poc (Helfer-Kanal, Dummy-Daten).
// Lädt den unveränderten Hintergrund von Kadri und danach den Helfer-Kanal. Die normalen Builds verwenden weiterhin
// background.js direkt und enthalten nichts hiervon.
'use strict';
importScripts('background.js');
importScripts('channel/kadri_pairing_poc.js', 'channel/channel-store.js', 'channel/channel-transport.js',
  'channel/channel-session.js', 'channel/channel-service.js');
