package nl.kiteweer.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Startscherm-widget: oordeel van vandaag, wind, de eerstvolgende kitemogelijkheid en (als de
 * widget hoog genoeg is) een grafiek van vandaag — voor de eerste favoriete locatie. De gegevens
 * komen van KiteweerAchtergrond (die ze bij de backend ophaalt); deze klasse tekent alleen.
 */
public class KiteweerWidget extends AppWidgetProvider {
    // Vanaf deze hoogte (dp) past de grafiek eronder.
    private static final int MIN_HOOGTE_VOOR_GRAFIEK_DP = 150;

    @Override
    public void onUpdate(Context context, AppWidgetManager beheer, int[] ids) {
        for (int id : ids) teken(context, beheer, id);
        KiteweerAchtergrond.verversAlsVerouderd(context);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager beheer, int id, Bundle nieuweOpties) {
        teken(context, beheer, id);
    }

    @Override
    public void onEnabled(Context context) {
        KiteweerAchtergrond.planPeriodiek(context);
        KiteweerAchtergrond.verversNu(context);
    }

    /** Alle geplaatste widgets opnieuw tekenen (na nieuwe gegevens). */
    static void werkAllesBij(Context context) {
        AppWidgetManager beheer = AppWidgetManager.getInstance(context);
        int[] ids = beheer.getAppWidgetIds(new ComponentName(context, KiteweerWidget.class));
        for (int id : ids) teken(context, beheer, id);
    }

    private static void teken(Context context, AppWidgetManager beheer, int id) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.kiteweer_widget);

        Intent openApp = new Intent(context, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        views.setOnClickPendingIntent(R.id.widget_root,
                PendingIntent.getActivity(context, 0, openApp, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));

        String tekst = context.getSharedPreferences(KiteweerAchtergrond.PREFS_EIGEN, Context.MODE_PRIVATE)
                .getString(KiteweerAchtergrond.SLEUTEL_WIDGET, null);
        JSONObject data = null;
        try {
            data = tekst != null ? new JSONObject(tekst) : null;
        } catch (JSONException e) {
            data = null;
        }

        if (data == null) {
            views.setInt(R.id.widget_root, "setBackgroundResource", R.drawable.widget_bg_grijs);
            views.setTextViewText(R.id.widget_spot, "Kite Weer App");
            views.setTextViewText(R.id.widget_bijgewerkt, "");
            views.setTextViewText(R.id.widget_score, "–");
            views.setTextViewText(R.id.widget_verdict, "Open de app om de widget te vullen");
            views.setTextViewText(R.id.widget_wind, "");
            views.setTextViewText(R.id.widget_kans, "");
            views.setViewVisibility(R.id.widget_grafiek, View.GONE);
            beheer.updateAppWidget(id, views);
            return;
        }

        String kleur = data.optString("kleur", "");
        views.setInt(R.id.widget_root, "setBackgroundResource", achtergrondVoor(kleur));
        views.setTextViewText(R.id.widget_spot, data.optString("spotnaam", "Kite Weer App"));
        views.setTextViewText(R.id.widget_bijgewerkt, "⟳ " + data.optString("bijgewerkt", ""));
        views.setTextViewText(R.id.widget_score, data.isNull("score") ? "–" : formatScore(data.optDouble("score")) + "/10");
        views.setTextViewText(R.id.widget_verdict, "Vandaag · " + data.optString("verdict", ""));
        views.setTextViewText(R.id.widget_wind, windTekst(data));
        views.setTextViewText(R.id.widget_kans, kansTekst(data.optJSONObject("volgendeKans")));

        Bundle opties = beheer.getAppWidgetOptions(id);
        // Staand (de gewone telefoonstand) is de widget MIN_WIDTH breed en MAX_HEIGHT hoog.
        int hoogteDp = opties.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0);
        if (hoogteDp <= 0) hoogteDp = opties.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0);
        int breedteDp = opties.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0);
        if (breedteDp <= 0) breedteDp = 250;
        JSONArray uren = data.optJSONArray("uren");
        if (hoogteDp >= MIN_HOOGTE_VOOR_GRAFIEK_DP && uren != null && uren.length() > 1) {
            float dichtheid = context.getResources().getDisplayMetrics().density;
            int breedtePx = Math.max(200, Math.round((breedteDp - 24) * dichtheid));
            int hoogtePx = Math.round(Math.min(110, Math.max(60, hoogteDp - 120)) * dichtheid);
            views.setImageViewBitmap(R.id.widget_grafiek, tekenGrafiek(context, uren, breedtePx, hoogtePx, dichtheid));
            views.setViewVisibility(R.id.widget_grafiek, View.VISIBLE);
        } else {
            views.setViewVisibility(R.id.widget_grafiek, View.GONE);
        }
        beheer.updateAppWidget(id, views);
    }

    static int achtergrondVoor(String kleur) {
        if ("groen".equals(kleur)) return R.drawable.widget_bg_groen;
        if ("oranje".equals(kleur)) return R.drawable.widget_bg_oranje;
        if ("rood".equals(kleur)) return R.drawable.widget_bg_rood;
        return R.drawable.widget_bg_grijs;
    }

    private static String formatScore(double score) {
        return score == Math.rint(score) ? String.valueOf((long) score) : String.valueOf(Math.round(score * 10) / 10.0);
    }

    private static String windTekst(JSONObject data) {
        if (data.isNull("windKnopen")) return "";
        StringBuilder sb = new StringBuilder("💨 ").append(data.optInt("windKnopen")).append(" kn");
        if (!data.isNull("windrichtingKompas")) sb.append(' ').append(data.optString("windrichtingKompas"));
        if (!data.isNull("windvlaagKnopen")) sb.append(" · vlagen ").append(data.optInt("windvlaagKnopen")).append(" kn");
        return sb.toString();
    }

    private static String kansTekst(JSONObject kans) {
        if (kans == null || !kans.optBoolean("gevonden", false)) return "Volgende kans: geen binnen je horizon";
        return "Volgende kans: " + kans.optString("dagLabel") + " " + kans.optString("vanaf") + "–" + kans.optString("tot")
                + " (" + formatScore(kans.optDouble("score")) + "/10)";
    }

    /**
     * Zelfde opbouw als de Grafiek-tab van de app (bouwUurGrafiek in JavaScript.html): balken =
     * windsnelheid (kleur = oordeel van dat uur), lijn = windvlagen, op één kn-schaal afgerond op 5.
     */
    static Bitmap tekenGrafiek(Context context, JSONArray uren, int breedte, int hoogte, float dichtheid) {
        boolean donker = (context.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        int tekstKleur = donker ? 0xDDFFFFFF : 0xDD000000;
        int lijnKleur = donker ? 0xFFFFFFFF : 0xFF263238;

        Bitmap bitmap = Bitmap.createBitmap(breedte, hoogte, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        Paint tekst = new Paint(Paint.ANTI_ALIAS_FLAG);
        tekst.setColor(tekstKleur);
        tekst.setTextSize(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, 10, context.getResources().getDisplayMetrics()));

        float labelHoogte = tekst.getTextSize() + 3 * dichtheid;
        float asBreedte = tekst.measureText("30") + 4 * dichtheid;
        float plotLinks = asBreedte;
        float plotBoven = tekst.getTextSize() / 2;
        float plotBreedte = breedte - plotLinks;
        float plotHoogte = hoogte - labelHoogte - plotBoven;

        double max = 5;
        for (int i = 0; i < uren.length(); i++) {
            JSONObject u = uren.optJSONObject(i);
            if (u == null) continue;
            if (!u.isNull("windKnopen")) max = Math.max(max, u.optDouble("windKnopen"));
            if (!u.isNull("windvlaagKnopen")) max = Math.max(max, u.optDouble("windvlaagKnopen"));
        }
        max = Math.ceil(max / 5.0) * 5;

        // As-label bovenaan en hulplijn halverwege.
        canvas.drawText(String.valueOf((int) max), 0, plotBoven + tekst.getTextSize() / 2, tekst);
        Paint hulplijn = new Paint();
        hulplijn.setColor(donker ? 0x33FFFFFF : 0x22000000);
        hulplijn.setStrokeWidth(dichtheid);
        canvas.drawLine(plotLinks, plotBoven, breedte, plotBoven, hulplijn);
        canvas.drawLine(plotLinks, plotBoven + plotHoogte / 2, breedte, plotBoven + plotHoogte / 2, hulplijn);

        int n = uren.length();
        float kolom = plotBreedte / n;
        float marge = Math.max(1, kolom * 0.15f);
        Paint balk = new Paint(Paint.ANTI_ALIAS_FLAG);
        Path vlaagLijn = new Path();
        boolean lijnGestart = false;
        float straal = 2 * dichtheid;

        for (int i = 0; i < n; i++) {
            JSONObject u = uren.optJSONObject(i);
            if (u == null) continue;
            float x = plotLinks + i * kolom;
            if (!u.isNull("windKnopen")) {
                float h = (float) (u.optDouble("windKnopen") / max) * plotHoogte;
                balk.setColor(KiteweerMeldingen.kleurVan(u.optString("kleur")));
                canvas.drawRoundRect(new RectF(x + marge, plotBoven + plotHoogte - h, x + kolom - marge, plotBoven + plotHoogte), straal, straal, balk);
            }
            if (!u.isNull("windvlaagKnopen")) {
                float y = plotBoven + plotHoogte - (float) (u.optDouble("windvlaagKnopen") / max) * plotHoogte;
                float midden = x + kolom / 2;
                if (lijnGestart) vlaagLijn.lineTo(midden, y);
                else {
                    vlaagLijn.moveTo(midden, y);
                    lijnGestart = true;
                }
            }
            int uur = u.optInt("uur", -1);
            if (uur >= 0 && uur % 3 == 0) {
                String label = String.valueOf(uur);
                canvas.drawText(label, x + kolom / 2 - tekst.measureText(label) / 2, hoogte - 2 * dichtheid, tekst);
            }
        }
        Paint lijn = new Paint(Paint.ANTI_ALIAS_FLAG);
        lijn.setStyle(Paint.Style.STROKE);
        lijn.setStrokeWidth(2 * dichtheid);
        lijn.setColor(lijnKleur);
        canvas.drawPath(vlaagLijn, lijn);
        return bitmap;
    }
}
