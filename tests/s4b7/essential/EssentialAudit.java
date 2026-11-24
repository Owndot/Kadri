package de.evp.helfer.dash;

import java.io.File;
import java.nio.file.Files;

/** S4b-7a (Audit, Vorschlag): heutiger dashplan-Code des Helfers je MPD-Datei – nur lesen, keine Änderung am Helfer. */
public final class EssentialAudit {
    public static void main(String[] args) throws Exception {
        for (int i = 1; i < args.length; i++) {
            File f = new File(args[i]);
            String code;
            try {
                DashManifest m = DashManifest.parse(Files.readAllBytes(f.toPath()), args[0]);
                DashProfile.check(m);
                try { DashPlan.build(m); code = "ok"; } catch (DashException e) { code = e.reason; }
            } catch (DashException e) { code = "mpd_" + e.reason; }
            System.out.println(f.getName() + "\t" + code.replace('-', '_'));
        }
    }
}
