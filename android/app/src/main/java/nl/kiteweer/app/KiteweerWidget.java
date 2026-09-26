package nl.kiteweer.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Typeface;
import android.os.Bundle;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.StyleSpan;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.Calendar;
import java.util.Locale;

/**
 * Startscherm-widget voor de eerste favoriete locatie, in pagina's: pagina 1 is het overzicht
 * (oordeel vandaag, wind, volgende kans, oordeel per dag), daarna één pagina per dag van de
 * Voorspellingshorizon met de windgrafiek. Onderaan bladeren de pijltjes; een tik op een dag in het
 * overzicht springt meteen naar die pagina. De gegevens komen van KiteweerAchtergrond (die ze bij de
 * backend ophaalt); deze klasse tekent alleen.
 */
public class KiteweerWidget extends AppWidgetProvider {
    /** Tik op de bijwerktijd in de kop: meteen nieuwe gegevens ophalen. */
    static final String ACTIE_VERVERS = "nl.kiteweer.app.WIDGET_VERVERS";
    /** Tik op een pijltje of dag-chip: naar pagina EXTRA_PAGINA. */
    static final String ACTIE_PAGINA = "nl.kiteweer.app.WIDGET_PAGINA";
    static final String EXTRA_PAGINA = "pagina";

    private static final String PREFS_PAGINA = "KiteweerWidgetPagina";
    // Onder deze hoogte (dp) verdwijnt de detailregel op de dagpagina's.
    private static final int COMPACT_HOOGTE_DP = 200;

    private static final int[] CHIPS = {
            R.id.overzicht_chip1, R.id.overzicht_chip2, R.id.overzicht_chip3, R.id.overzicht_chip4, R.id.overzicht_chip5,
    };

    @Override
    public void onUpdate(Context context, AppWidgetManager beheer, int[] ids) {
        for (int id : ids) teken(context, beheer, id);
        KiteweerAchtergrond.verversAlsVerouderd(context);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager beheer, int id, Bundle nieuweOpties) {
        // Andere maat: de grafiek opnieuw tekenen op de nieuwe breedte/hoogte.
        teken(context, beheer, id);
    }

    @Override
    public void onEnabled(Context context) {
        KiteweerAchtergrond.planPeriodiek(context);
        KiteweerAchtergrond.verversNu(context);
    }

    @Override
    public void onDeleted(Context context, int[] ids) {
        SharedPreferences.Editor e = context.getSharedPreferences(PREFS_PAGINA, Context.MODE_PRIVATE).edit();
        for (int id : ids) e.remove("pagina_" + id).remove("tijd_" + id);
        e.apply();
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        if (ACTIE_VERVERS.equals(intent.getAction())) {
            KiteweerAchtergrond.verversNu(context);
            return;
        }
        if (ACTIE_PAGINA.equals(intent.getAction())) {
            int id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
            if (id == AppWidgetManager.INVALID_APPWIDGET_ID) return;
            context.getSharedPreferences(PREFS_PAGINA, Context.MODE_PRIVATE).edit()
                    .putInt("pagina_" + id, intent.getIntExtra(EXTRA_PAGINA, 0))
                    .putLong("tijd_" + id, System.currentTimeMillis())
                    .apply();
            teken(context, AppWidgetManager.getInstance(context), id);
            return;
        }
        super.onReceive(context, intent);
    }

    /** Alle geplaatste widgets opnieuw tekenen (na nieuwe gegevens). */
    static void werkAllesBij(Context context) {
        AppWidgetManager beheer = AppWidgetManager.getInstance(context);
        int[] ids = beheer.getAppWidgetIds(new ComponentName(context, KiteweerWidget.class));
        for (int id : ids) teken(context, beheer, id);
    }

    /** De laatst opgehaalde widget-gegevens, of null (app nog nooit geopend / onleesbaar). */
    static JSONObject leesData(Context context) {
        String tekst = context.getSharedPreferences(KiteweerAchtergrond.PREFS_EIGEN, Context.MODE_PRIVATE)
                .getString(KiteweerAchtergrond.SLEUTEL_WIDGET, null);
        try {
            return tekst != null ? new JSONObject(tekst) : null;
        } catch (JSONException e) {
            return null;
        }
    }

    /**
     * { breedteDp, hoogteDp } van de widget. Staand (de gewone telefoonstand) is de widget
     * MIN_WIDTH breed en MAX_HEIGHT hoog.
     */
    static int[] maten(AppWidgetManager beheer, int id) {
        Bundle opties = beheer.getAppWidgetOptions(id);
        int breedteDp = opties.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0);
        int hoogteDp = opties.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0);
        if (hoogteDp <= 0) hoogteDp = opties.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0);
        return new int[] { breedteDp > 0 ? breedteDp : 250, hoogteDp > 0 ? hoogteDp : 180 };
    }

    private static void teken(Context context, AppWidgetManager beheer, int id) {
        beheer.updateAppWidget(id, bouw(context, beheer, id));
    }

    /** De complete widget voor de huidige pagina (los van teken() zodat hij te testen/renderen is). */
    static RemoteViews bouw(Context context, AppWidgetManager beheer, int id) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.kiteweer_widget);

        Intent openApp = new Intent(context, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent openAppKlik = PendingIntent.getActivity(context, 0, openApp, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        views.setOnClickPendingIntent(R.id.widget_root, openAppKlik);
        views.setOnClickPendingIntent(R.id.widget_overzicht, openAppKlik);
        views.setOnClickPendingIntent(R.id.widget_dag, openAppKlik);

        Intent ververs = new Intent(context, KiteweerWidget.class).setAction(ACTIE_VERVERS);
        views.setOnClickPendingIntent(R.id.widget_bijgewerkt,
                PendingIntent.getBroadcast(context, 0, ververs, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));

        JSONObject data = leesData(context);
        if (data == null) {
            views.setInt(R.id.widget_root, "setBackgroundResource", R.drawable.widget_bg_grijs);
            views.setTextViewText(R.id.widget_spot, context.getString(R.string.app_name));
            views.setTextViewText(R.id.widget_bijgewerkt, "");
            views.setViewVisibility(R.id.widget_overzicht, View.GONE);
            views.setViewVisibility(R.id.widget_dag, View.GONE);
            views.setViewVisibility(R.id.widget_navigatie, View.GONE);
            views.setViewVisibility(R.id.widget_leeg, View.VISIBLE);
            return views;
        }

        views.setInt(R.id.widget_root, "setBackgroundResource", achtergrondVoor(data.optString("kleur", "")));
        views.setTextViewText(R.id.widget_spot, data.optString("spotnaam", context.getString(R.string.app_name)));
        views.setTextViewText(R.id.widget_bijgewerkt, "⟳ " + data.optString("bijgewerkt", ""));
        views.setViewVisibility(R.id.widget_leeg, View.GONE);

        JSONArray dagen = KiteweerWidgetTekst.dagen(data);
        int aantal = 1 + dagen.length();
        SharedPreferences paginas = context.getSharedPreferences(PREFS_PAGINA, Context.MODE_PRIVATE);
        int pagina = KiteweerWidgetTekst.huidigePagina(paginas.getInt("pagina_" + id, 0),
                paginas.getLong("tijd_" + id, 0), System.currentTimeMillis(), aantal);
        int[] maten = maten(beheer, id);

        if (pagina == 0) {
            views.setViewVisibility(R.id.widget_overzicht, View.VISIBLE);
            views.setViewVisibility(R.id.widget_dag, View.GONE);
            vulOverzicht(context, views, id, data, dagen, maten[0]);
        } else {
            views.setViewVisibility(R.id.widget_overzicht, View.GONE);
            views.setViewVisibility(R.id.widget_dag, View.VISIBLE);
            vulDag(context, views, dagen, pagina - 1, maten);
        }

        // Navigatie: ‹ verborgen op de eerste pagina; › op de laatste gaat terug naar het overzicht.
        views.setViewVisibility(R.id.widget_navigatie, aantal > 1 ? View.VISIBLE : View.GONE);
        views.setTextViewText(R.id.widget_pagina, KiteweerWidgetTekst.paginaLabel(dagen, pagina));
        views.setViewVisibility(R.id.widget_vorige, pagina > 0 ? View.VISIBLE : View.INVISIBLE);
        views.setOnClickPendingIntent(R.id.widget_vorige, naarPagina(context, id, 0, pagina - 1));
        views.setOnClickPendingIntent(R.id.widget_volgende, naarPagina(context, id, 1, (pagina + 1) % aantal));
        return views;
    }

    /** Broadcast naar pagina `doel`; `slot` houdt de PendingIntents per widget en knop uit elkaar. */
    private static PendingIntent naarPagina(Context context, int id, int slot, int doel) {
        Intent intent = new Intent(context, KiteweerWidget.class)
                .setAction(ACTIE_PAGINA)
                .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
                .putExtra(EXTRA_PAGINA, doel);
        return PendingIntent.getBroadcast(context, id * 16 + slot, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private static void vulOverzicht(Context context, RemoteViews v, int id, JSONObject data, JSONArray dagen, int breedteDp) {
        v.setInt(R.id.overzicht_badge, "setBackgroundResource", badgeVoor(data.optString("kleur")));
        v.setTextViewText(R.id.overzicht_score, KiteweerWidgetTekst.score(data));
        v.setTextViewText(R.id.overzicht_verdict, data.optString("verdict", ""));
        String wind = KiteweerWidgetTekst.windTekst(data);
        v.setTextViewText(R.id.overzicht_wind, wind);
        v.setViewVisibility(R.id.overzicht_wind, wind.isEmpty() ? View.GONE : View.VISIBLE);
        v.setTextViewText(R.id.overzicht_kans, KiteweerWidgetTekst.kansTekst(data.optJSONObject("volgendeKans")));

        // Oordeel per dag als chips (zoveel als er in de breedte passen, 3-5); tik = naar die dag.
        int aantal = Math.min(dagen.length(), Math.max(3, Math.min(CHIPS.length, (breedteDp - 24) / 60)));
        for (int i = 0; i < CHIPS.length; i++) {
            JSONObject dag = i < aantal ? dagen.optJSONObject(i) : null;
            if (dag == null) {
                v.setViewVisibility(CHIPS[i], View.GONE);
                continue;
            }
            v.setViewVisibility(CHIPS[i], View.VISIBLE);
            v.setTextViewText(CHIPS[i], KiteweerWidgetTekst.chipTekst(dag));
            v.setInt(CHIPS[i], "setBackgroundResource", badgeVoor(dag.optString("kleur")));
            v.setOnClickPendingIntent(CHIPS[i], naarPagina(context, id, 2 + i, 1 + i));
        }
        v.setViewVisibility(R.id.overzicht_dagen, aantal > 1 ? View.VISIBLE : View.GONE);
    }

    private static void vulDag(Context context, RemoteViews v, JSONArray dagen, int index, int[] maten) {
        JSONObject dag = dagen.optJSONObject(index);
        if (dag == null) dag = new JSONObject();

        v.setTextViewText(R.id.dag_score, KiteweerWidgetTekst.score(dag));
        v.setInt(R.id.dag_score, "setBackgroundResource", badgeVoor(dag.optString("kleur")));

        SpannableStringBuilder titel = new SpannableStringBuilder(dag.optString("dagLabel", ""));
        titel.setSpan(new StyleSpan(Typeface.BOLD), 0, titel.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        String datum = KiteweerWidgetTekst.datumNaastLabel(dag);
        if (!datum.isEmpty()) titel.append("  ").append(datum);
        v.setTextViewText(R.id.dag_titel, titel);

        String venster = KiteweerWidgetTekst.vensterTekst(dag);
        v.setTextViewText(R.id.dag_venster, venster);
        v.setViewVisibility(R.id.dag_venster, venster.isEmpty() ? View.GONE : View.VISIBLE);
        v.setTextViewText(R.id.dag_detail, KiteweerWidgetTekst.dagDetail(dag));
        // Lage widget: de detailregel wijkt voor de grafiek.
        boolean compact = maten[1] < COMPACT_HOOGTE_DP;
        v.setViewVisibility(R.id.dag_detail, compact ? View.GONE : View.VISIBLE);

        // De grafiek vult de ruimte tussen de dagkop en de bladerknoppen.
        int inhoudHoogteDp = maten[1] - 16 - 22 - 32;
        int grafiekHoogteDp = Math.max(50, Math.min(180, inhoudHoogteDp - (compact ? 36 : 52)));
        int grafiekBreedteDp = Math.max(150, maten[0] - 40);
        v.setImageViewBitmap(R.id.dag_grafiek, KiteweerGrafiek.tekenDag(context, dag, isVandaag(dag),
                KiteweerWidgetTekst.schaalMax(dagen), grafiekBreedteDp, grafiekHoogteDp));
    }

    /** Alleen vandaag krijgt de "nu"-lijn (niet de dag van gisteren uit verouderde gegevens). */
    private static boolean isVandaag(JSONObject dag) {
        Calendar nu = Calendar.getInstance();
        String vandaag = String.format(Locale.ROOT, "%04d-%02d-%02d", nu.get(Calendar.YEAR), nu.get(Calendar.MONTH) + 1, nu.get(Calendar.DAY_OF_MONTH));
        return vandaag.equals(dag.optString("datum", null)) || (dag.isNull("datum") && "Vandaag".equals(dag.optString("dagLabel")));
    }

    static int achtergrondVoor(String kleur) {
        if ("groen".equals(kleur)) return R.drawable.widget_bg_groen;
        if ("oranje".equals(kleur)) return R.drawable.widget_bg_oranje;
        if ("rood".equals(kleur)) return R.drawable.widget_bg_rood;
        return R.drawable.widget_bg_grijs;
    }

    static int badgeVoor(String kleur) {
        if ("groen".equals(kleur)) return R.drawable.widget_badge_groen;
        if ("oranje".equals(kleur)) return R.drawable.widget_badge_oranje;
        if ("rood".equals(kleur)) return R.drawable.widget_badge_rood;
        return R.drawable.widget_badge_grijs;
    }
}
