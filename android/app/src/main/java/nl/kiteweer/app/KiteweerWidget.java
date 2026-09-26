package nl.kiteweer.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.widget.RemoteViews;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * Startscherm-widget voor de eerste favoriete locatie: een vaste kop (spot, tijd van bijwerken)
 * met daaronder een scrollbare lijst (KiteweerWidgetService): eerst het overzicht van vandaag,
 * daarna per dag een kaart met de windgrafiek. De gegevens komen van KiteweerAchtergrond (die ze
 * bij de backend ophaalt); deze klasse tekent alleen.
 */
// setRemoteAdapter(int, Intent) en notifyAppWidgetViewDataChanged zijn deprecated ten gunste van
// RemoteCollectionItems, maar dat bestaat pas vanaf API 31 (minSdk is 24).
@SuppressWarnings("deprecation")
public class KiteweerWidget extends AppWidgetProvider {
    /** Tik op de bijwerktijd in de kop: meteen nieuwe gegevens ophalen. */
    static final String ACTIE_VERVERS = "nl.kiteweer.app.WIDGET_VERVERS";

    @Override
    public void onUpdate(Context context, AppWidgetManager beheer, int[] ids) {
        for (int id : ids) teken(context, beheer, id);
        beheer.notifyAppWidgetViewDataChanged(ids, R.id.widget_lijst);
        KiteweerAchtergrond.verversAlsVerouderd(context);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager beheer, int id, Bundle nieuweOpties) {
        // Andere maat: de grafieken opnieuw tekenen op de nieuwe breedte/hoogte.
        teken(context, beheer, id);
        beheer.notifyAppWidgetViewDataChanged(id, R.id.widget_lijst);
    }

    @Override
    public void onEnabled(Context context) {
        KiteweerAchtergrond.planPeriodiek(context);
        KiteweerAchtergrond.verversNu(context);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        if (ACTIE_VERVERS.equals(intent.getAction())) {
            KiteweerAchtergrond.verversNu(context);
            return;
        }
        super.onReceive(context, intent);
    }

    /** Alle geplaatste widgets opnieuw tekenen (na nieuwe gegevens). */
    static void werkAllesBij(Context context) {
        AppWidgetManager beheer = AppWidgetManager.getInstance(context);
        int[] ids = beheer.getAppWidgetIds(new ComponentName(context, KiteweerWidget.class));
        for (int id : ids) teken(context, beheer, id);
        beheer.notifyAppWidgetViewDataChanged(ids, R.id.widget_lijst);
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
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.kiteweer_widget);

        Intent openApp = new Intent(context, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        views.setOnClickPendingIntent(R.id.widget_root,
                PendingIntent.getActivity(context, 0, openApp, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        // Lijstitems openen de app via een sjabloon + (lege) fill-in; dat sjabloon moet vanaf
        // Android 12 mutable zijn, anders wordt de fill-in genegeerd.
        int sjabloonVlaggen = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
        views.setPendingIntentTemplate(R.id.widget_lijst, PendingIntent.getActivity(context, 1, openApp, sjabloonVlaggen));

        Intent ververs = new Intent(context, KiteweerWidget.class).setAction(ACTIE_VERVERS);
        views.setOnClickPendingIntent(R.id.widget_bijgewerkt,
                PendingIntent.getBroadcast(context, 0, ververs, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));

        // Eén lijst per widget: de data-URI maakt de intent uniek, anders deelt het systeem de fabriek.
        Intent dienst = new Intent(context, KiteweerWidgetService.class).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
        dienst.setData(Uri.parse(dienst.toUri(Intent.URI_INTENT_SCHEME)));
        views.setRemoteAdapter(R.id.widget_lijst, dienst);
        views.setEmptyView(R.id.widget_lijst, R.id.widget_leeg);

        JSONObject data = leesData(context);
        if (data == null) {
            views.setInt(R.id.widget_root, "setBackgroundResource", R.drawable.widget_bg_grijs);
            views.setTextViewText(R.id.widget_spot, context.getString(R.string.app_name));
            views.setTextViewText(R.id.widget_bijgewerkt, "");
            views.setTextViewText(R.id.widget_leeg, context.getString(R.string.widget_leeg));
        } else {
            views.setInt(R.id.widget_root, "setBackgroundResource", achtergrondVoor(data.optString("kleur", "")));
            views.setTextViewText(R.id.widget_spot, data.optString("spotnaam", context.getString(R.string.app_name)));
            views.setTextViewText(R.id.widget_bijgewerkt, "⟳ " + data.optString("bijgewerkt", ""));
            views.setTextViewText(R.id.widget_leeg, context.getString(R.string.widget_laden));
        }
        beheer.updateAppWidget(id, views);
    }

    static int achtergrondVoor(String kleur) {
        if ("groen".equals(kleur)) return R.drawable.widget_bg_groen;
        if ("oranje".equals(kleur)) return R.drawable.widget_bg_oranje;
        if ("rood".equals(kleur)) return R.drawable.widget_bg_rood;
        return R.drawable.widget_bg_grijs;
    }
}
