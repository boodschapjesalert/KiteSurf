package nl.kiteweer.app;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONObject;

/** Android-meldingen voor de dagelijkse samenvatting en de directe alert (inhoud komt van de backend). */
final class KiteweerMeldingen {
    static final String KANAAL_ALERT = "kiteweer_alert";
    static final String KANAAL_SAMENVATTING = "kiteweer_samenvatting";

    private KiteweerMeldingen() {}

    static void maakKanalen(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager beheer = context.getSystemService(NotificationManager.class);
        NotificationChannel alert = new NotificationChannel(KANAAL_ALERT, "Directe alert", NotificationManager.IMPORTANCE_HIGH);
        alert.setDescription("Zodra een favoriete locatie een nieuwe goede kitedag krijgt");
        NotificationChannel samenvatting = new NotificationChannel(KANAAL_SAMENVATTING, "Dagelijkse samenvatting", NotificationManager.IMPORTANCE_DEFAULT);
        samenvatting.setDescription("Eén keer per dag het oordeel per favoriete locatie");
        beheer.createNotificationChannel(alert);
        beheer.createNotificationChannel(samenvatting);
    }

    static boolean magTonen(Context context) {
        if (Build.VERSION.SDK_INT >= 33
                && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return false;
        }
        return NotificationManagerCompat.from(context).areNotificationsEnabled();
    }

    static int kleurVan(String kleur) {
        if ("groen".equals(kleur)) return 0xFF2E7D32;
        if ("oranje".equals(kleur)) return 0xFFEF6C00;
        if ("rood".equals(kleur)) return 0xFFC62828;
        return 0xFF607D8B;
    }

    /** @param melding { soort, locatieId, datum, kleur, titel, kortTekst, tekst } — zie appApi.bepaalAppMeldingen. */
    static void toon(Context context, JSONObject melding) {
        if (!magTonen(context)) return;
        maakKanalen(context);
        String soort = melding.optString("soort");
        String kanaal = "alert".equals(soort) ? KANAAL_ALERT : KANAAL_SAMENVATTING;

        Intent openApp = new Intent(context, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent klik = PendingIntent.getActivity(context, 0, openApp, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        NotificationCompat.Builder bouwer = new NotificationCompat.Builder(context, kanaal)
                .setSmallIcon(R.drawable.ic_stat_kite)
                .setColor(kleurVan(melding.optString("kleur")))
                .setContentTitle(melding.optString("titel"))
                .setContentText(melding.optString("kortTekst"))
                .setStyle(new NotificationCompat.BigTextStyle().bigText(melding.optString("tekst")))
                .setPriority("alert".equals(soort) ? NotificationCompat.PRIORITY_HIGH : NotificationCompat.PRIORITY_DEFAULT)
                .setContentIntent(klik)
                .setAutoCancel(true);

        // Vaste id per soort/locatie/datum: een nieuwe samenvatting vervangt die van gisteren niet,
        // maar dezelfde melding twee keer tonen overschrijft zichzelf i.p.v. te stapelen.
        int id = (soort + "|" + melding.optString("locatieId") + "|" + melding.optString("datum")).hashCode();
        try {
            NotificationManagerCompat.from(context).notify(id, bouwer.build());
        } catch (SecurityException e) {
            // Toestemming net ingetrokken: niets te doen.
        }
    }
}
