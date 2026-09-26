package nl.kiteweer.app;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Typeface;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.StyleSpan;
import android.view.View;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Calendar;
import java.util.Locale;

/**
 * Vult de scrollbare lijst van de widget: item 0 is het overzicht (zoals de widget altijd al
 * toonde), daarna één kaart per dag van de Voorspellingshorizon met de grafiek van die dag.
 */
public class KiteweerWidgetService extends RemoteViewsService {

    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        return new Fabriek(getApplicationContext(), intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID));
    }

    private static final int[] CHIPS = {
            R.id.overzicht_chip1, R.id.overzicht_chip2, R.id.overzicht_chip3, R.id.overzicht_chip4, R.id.overzicht_chip5,
    };

    static int badgeVoor(String kleur) {
        if ("groen".equals(kleur)) return R.drawable.widget_badge_groen;
        if ("oranje".equals(kleur)) return R.drawable.widget_badge_oranje;
        if ("rood".equals(kleur)) return R.drawable.widget_badge_rood;
        return R.drawable.widget_badge_grijs;
    }

    static final class Fabriek implements RemoteViewsFactory {
        private final Context context;
        private final int widgetId;
        private JSONObject data;
        private JSONArray dagen = new JSONArray();
        private int schaalMax = 15;
        private int breedteDp = 250;
        private int hoogteDp = 180;

        Fabriek(Context context, int widgetId) {
            this.context = context;
            this.widgetId = widgetId;
        }

        @Override
        public void onCreate() {}

        @Override
        public void onDataSetChanged() {
            data = KiteweerWidget.leesData(context);
            dagen = data != null ? KiteweerWidgetTekst.dagen(data) : new JSONArray();
            schaalMax = KiteweerWidgetTekst.schaalMax(dagen);
            int[] maten = KiteweerWidget.maten(AppWidgetManager.getInstance(context), widgetId);
            breedteDp = maten[0];
            hoogteDp = maten[1];
        }

        @Override
        public void onDestroy() {}

        @Override
        public int getCount() {
            return data == null ? 0 : 1 + dagen.length();
        }

        @Override
        public RemoteViews getViewAt(int positie) {
            if (data == null) return null;
            return positie == 0 ? bouwOverzicht() : bouwDag(positie - 1);
        }

        private RemoteViews bouwOverzicht() {
            RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.kiteweer_widget_overzicht);
            v.setOnClickFillInIntent(R.id.overzicht_root, new Intent());
            v.setInt(R.id.overzicht_badge, "setBackgroundResource", badgeVoor(data.optString("kleur")));
            v.setTextViewText(R.id.overzicht_score, KiteweerWidgetTekst.score(data));
            v.setTextViewText(R.id.overzicht_verdict, data.optString("verdict", ""));
            String wind = KiteweerWidgetTekst.windTekst(data);
            v.setTextViewText(R.id.overzicht_wind, wind);
            v.setViewVisibility(R.id.overzicht_wind, wind.isEmpty() ? View.GONE : View.VISIBLE);
            v.setTextViewText(R.id.overzicht_kans, KiteweerWidgetTekst.kansTekst(data.optJSONObject("volgendeKans")));

            // Oordeel per dag als chips; zoveel als er in de breedte passen (3-5).
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
            }
            v.setViewVisibility(R.id.overzicht_dagen, aantal > 1 ? View.VISIBLE : View.GONE);
            v.setViewVisibility(R.id.overzicht_hint, dagen.length() > 0 ? View.VISIBLE : View.GONE);
            return v;
        }

        private RemoteViews bouwDag(int index) {
            RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.kiteweer_widget_dag);
            v.setOnClickFillInIntent(R.id.dag_root, new Intent());
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

            // Grafiek zo hoog dat één kaart ongeveer de zichtbare lijst vult (scrollen = volgende dag).
            int lijstHoogteDp = hoogteDp - 44;
            int grafiekHoogteDp = Math.max(70, Math.min(150, lijstHoogteDp - 56));
            int grafiekBreedteDp = Math.max(150, breedteDp - 40);
            v.setImageViewBitmap(R.id.dag_grafiek,
                    KiteweerGrafiek.tekenDag(context, dag, isVandaag(dag), schaalMax, grafiekBreedteDp, grafiekHoogteDp));
            return v;
        }

        /** Alleen vandaag krijgt de "nu"-lijn (niet de dag van gisteren uit verouderde gegevens). */
        private static boolean isVandaag(JSONObject dag) {
            Calendar nu = Calendar.getInstance();
            String vandaag = String.format(Locale.ROOT, "%04d-%02d-%02d", nu.get(Calendar.YEAR), nu.get(Calendar.MONTH) + 1, nu.get(Calendar.DAY_OF_MONTH));
            return vandaag.equals(dag.optString("datum", null)) || (dag.isNull("datum") && "Vandaag".equals(dag.optString("dagLabel")));
        }

        @Override
        public RemoteViews getLoadingView() {
            return null;
        }

        @Override
        public int getViewTypeCount() {
            return 2;
        }

        @Override
        public long getItemId(int positie) {
            return positie;
        }

        @Override
        public boolean hasStableIds() {
            return true;
        }
    }
}
