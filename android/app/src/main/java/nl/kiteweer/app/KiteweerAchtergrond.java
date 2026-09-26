package nl.kiteweer.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.work.Constraints;
import androidx.work.Data;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.io.InputStream;
import java.util.Calendar;
import java.util.concurrent.TimeUnit;

/**
 * Achtergrondtaak (WorkManager): haalt periodiek widget-gegevens en meldingen op bij de
 * Apps Script-backend ({"actie":"achtergrond"}, zie src/logica/appApi.js) met het profiel dat de
 * app lokaal bewaart, werkt de widget bij en toont Android-meldingen. Welke meldingen er moeten
 * komen bepaalt de backend (zelfde regels als de Telegram-meldingen); deze kant bewaart alleen
 * de meldingsstatus (welke dagen al gemeld zijn) en stuurt die bij de volgende aanroep terug.
 */
public class KiteweerAchtergrond extends Worker {
    private static final String TAG = "KiteweerAchtergrond";

    // Capacitor Preferences bewaart in SharedPreferences "CapacitorStorage" (zie src/app/app.js).
    static final String PREFS_CAPACITOR = "CapacitorStorage";
    static final String SLEUTEL_PROFIEL = "kiteweer_profiel";

    static final String PREFS_EIGEN = "KiteweerAchtergrond";
    static final String SLEUTEL_STATUS = "meldingStatus";
    static final String SLEUTEL_WIDGET = "widgetData";
    static final String SLEUTEL_WIDGET_TIJD = "widgetTijd";

    private static final String WERK_PERIODIEK = "kiteweer-periodiek";
    private static final String WERK_NU = "kiteweer-nu";
    private static final String WERK_SAMENVATTING = "kiteweer-samenvatting";
    private static final String INVOER_GEFORCEERD = "geforceerd";
    private static final String INVOER_SAMENVATTING = "samenvatting";

    // Elk half uur is ruim vaak genoeg (de backend cachet de bronnen 10-60 minuten) en spaart de
    // gratis quota van Apps Script en de weerbronnen.
    private static final long INTERVAL_MINUTEN = 30;
    // 's Nachts (22:30-06:30) niets ophalen: alerts wachten toch tot 07:00 (nachtrust), en
    // niemand kijkt dan naar de widget. De samenvatting heeft een eigen, exacte taak.
    private static final int NACHT_START_MINUUT = 22 * 60 + 30;
    private static final int NACHT_EIND_MINUUT = 6 * 60 + 30;

    // Twee taken tegelijk (periodiek + "nu") zouden anders allebei dezelfde alert kunnen tonen.
    private static final Object SLOT = new Object();

    public KiteweerAchtergrond(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    // --- Inplannen -----------------------------------------------------------------------------

    private static Constraints metNetwerk() {
        return new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
    }

    /** Periodieke controle; KEEP zodat elke app-start het ritme niet opnieuw laat beginnen. */
    static void planPeriodiek(Context context) {
        PeriodicWorkRequest verzoek = new PeriodicWorkRequest.Builder(KiteweerAchtergrond.class, INTERVAL_MINUTEN, TimeUnit.MINUTES)
                .setConstraints(metNetwerk())
                .build();
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(WERK_PERIODIEK, ExistingPeriodicWorkPolicy.KEEP, verzoek);
    }

    /** Meteen verversen (app geopend, profiel gewijzigd, widget geplaatst). */
    static void verversNu(Context context) {
        OneTimeWorkRequest verzoek = new OneTimeWorkRequest.Builder(KiteweerAchtergrond.class)
                .setConstraints(metNetwerk())
                .setInputData(new Data.Builder().putBoolean(INVOER_GEFORCEERD, true).build())
                .build();
        WorkManager.getInstance(context).enqueueUniqueWork(WERK_NU, ExistingWorkPolicy.REPLACE, verzoek);
    }

    /** Widget-gegevens ouder dan ~45 minuten: verversen (alleen overdag). */
    static void verversAlsVerouderd(Context context) {
        long tijd = context.getSharedPreferences(PREFS_EIGEN, Context.MODE_PRIVATE).getLong(SLEUTEL_WIDGET_TIJD, 0);
        if (System.currentTimeMillis() - tijd > TimeUnit.MINUTES.toMillis(45) && !isNacht(Calendar.getInstance())) {
            verversNu(context);
        }
    }

    /**
     * De dagelijkse samenvatting krijgt een eigen, eenmalige taak op het gekozen tijdstip — de
     * periodieke taak alleen zou tot een half uur te laat kunnen zijn. Eén minuut marge zodat de
     * klok van de backend het tijdstip zeker al gepasseerd is.
     */
    static void planSamenvatting(Context context, JSONObject profiel) {
        WorkManager werk = WorkManager.getInstance(context);
        JSONObject meldingen = profiel.optJSONObject("meldingen");
        if (meldingen == null || !meldingen.optBoolean("dagelijkseSamenvatting", false)) {
            werk.cancelUniqueWork(WERK_SAMENVATTING);
            return;
        }
        Calendar nu = Calendar.getInstance();
        Calendar doel = (Calendar) nu.clone();
        doel.set(Calendar.HOUR_OF_DAY, meldingen.optInt("samenvattingUur", 8));
        doel.set(Calendar.MINUTE, meldingen.optInt("samenvattingMinuut", 0));
        doel.set(Calendar.SECOND, 0);
        doel.set(Calendar.MILLISECOND, 0);
        doel.add(Calendar.MINUTE, 1);
        if (!doel.after(nu)) doel.add(Calendar.DAY_OF_MONTH, 1);

        OneTimeWorkRequest verzoek = new OneTimeWorkRequest.Builder(KiteweerAchtergrond.class)
                .setConstraints(metNetwerk())
                .setInitialDelay(doel.getTimeInMillis() - nu.getTimeInMillis(), TimeUnit.MILLISECONDS)
                .setInputData(new Data.Builder().putBoolean(INVOER_GEFORCEERD, true).putBoolean(INVOER_SAMENVATTING, true).build())
                .build();
        werk.enqueueUniqueWork(WERK_SAMENVATTING, ExistingWorkPolicy.REPLACE, verzoek);
    }

    static boolean isNacht(Calendar moment) {
        int minuut = moment.get(Calendar.HOUR_OF_DAY) * 60 + moment.get(Calendar.MINUTE);
        return minuut >= NACHT_START_MINUUT || minuut < NACHT_EIND_MINUUT;
    }

    // --- Uitvoeren -----------------------------------------------------------------------------

    @NonNull
    @Override
    public Result doWork() {
        synchronized (SLOT) {
            return voerUit();
        }
    }

    private Result voerUit() {
        // Geannuleerd terwijl deze taak op SLOT wachtte (bv. vervangen door een nieuwere "nu"-taak).
        if (isStopped()) return Result.success();
        Context context = getApplicationContext();
        String profielTekst = context.getSharedPreferences(PREFS_CAPACITOR, Context.MODE_PRIVATE).getString(SLEUTEL_PROFIEL, null);
        if (profielTekst == null) {
            // App nog nooit geopend: de widget vraagt dan om de app te openen.
            KiteweerWidget.werkAllesBij(context);
            return Result.success();
        }

        boolean geforceerd = getInputData().getBoolean(INVOER_GEFORCEERD, false);
        SharedPreferences eigen = context.getSharedPreferences(PREFS_EIGEN, Context.MODE_PRIVATE);
        try {
            JSONObject profiel = new JSONObject(profielTekst);
            // De samenvattingstaak plant zichzelf niet opnieuw in: REPLACE op de eigen, lopende
            // unieke taak zou haar annuleren. De eerstvolgende andere run plant morgen in (en elke
            // run ná het gekozen tijdstip levert de samenvatting sowieso, de backend beslist).
            if (!getInputData().getBoolean(INVOER_SAMENVATTING, false)) planSamenvatting(context, profiel);
            if (!geforceerd && isNacht(Calendar.getInstance())) return Result.success();

            JSONObject verzoek = new JSONObject();
            verzoek.put("actie", "achtergrond");
            verzoek.put("profiel", profiel);
            verzoek.put("status", new JSONObject(eigen.getString(SLEUTEL_STATUS, "{}")));

            JSONObject antwoord = KiteweerHttp.postJson(leesApiUrl(context), verzoek);
            if (antwoord.has("fout")) {
                Log.w(TAG, "Backend gaf een fout: " + antwoord.optString("fout"));
                return Result.success();
            }

            JSONObject widget = antwoord.optJSONObject("widget");
            if (widget != null && !widget.has("fout")) {
                eigen.edit()
                        .putString(SLEUTEL_WIDGET, widget.toString())
                        .putLong(SLEUTEL_WIDGET_TIJD, System.currentTimeMillis())
                        .apply();
            }
            KiteweerWidget.werkAllesBij(context);

            JSONArray meldingen = antwoord.optJSONArray("meldingen");
            if (meldingen != null) {
                for (int i = 0; i < meldingen.length(); i++) {
                    KiteweerMeldingen.toon(context, meldingen.getJSONObject(i));
                }
            }
            // Status pas ná het tonen opslaan, en commit() i.p.v. apply(): een volgende taak moet
            // de bijgewerkte status zeker zien (anders dubbele alerts).
            JSONObject status = antwoord.optJSONObject("status");
            if (status != null) eigen.edit().putString(SLEUTEL_STATUS, status.toString()).commit();
            return Result.success();
        } catch (IOException e) {
            Log.w(TAG, "Geen verbinding met de backend: " + e.getMessage());
            return getRunAttemptCount() < 3 ? Result.retry() : Result.success();
        } catch (JSONException e) {
            Log.w(TAG, "Onverwacht antwoord/profiel: " + e.getMessage());
            return Result.success();
        }
    }

    // --- HTTP ----------------------------------------------------------------------------------

    static String leesApiUrl(Context context) throws IOException, JSONException {
        try (InputStream in = context.getAssets().open("public/config.json")) {
            return new JSONObject(KiteweerHttp.leesAlles(in)).getString("apiUrl");
        }
    }
}
