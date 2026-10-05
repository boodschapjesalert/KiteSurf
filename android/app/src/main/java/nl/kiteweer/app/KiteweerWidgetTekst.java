package nl.kiteweer.app;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.Calendar;
import java.util.GregorianCalendar;

/**
 * Teksten en gegevens voor de widget, los van Android-klassen (dus op de JVM te testen). De
 * widget-data komt van de backend (bouwWidgetData_ in Code.gs, per dag: widgetData.bouwWidgetDag).
 */
final class KiteweerWidgetTekst {
    private static final String[] WEEKDAGEN = { "zo", "ma", "di", "wo", "do", "vr", "za" };

    private KiteweerWidgetTekst() {}

    static String formatScore(double score) {
        if (Double.isNaN(score)) return "–";
        return score == Math.rint(score) ? String.valueOf((long) score) : String.valueOf(Math.round(score * 10) / 10.0);
    }

    /** Score van een dag/kans-object, "–" als die ontbreekt. */
    static String score(JSONObject o) {
        return o == null || o.isNull("score") ? "–" : formatScore(o.optDouble("score"));
    }

    /** "💨 18 kn ZW · vlagen 24 kn", leeg zonder wind. */
    static String windTekst(JSONObject o) {
        if (o == null || o.isNull("windKnopen")) return "";
        StringBuilder sb = new StringBuilder("💨 ").append(o.optInt("windKnopen")).append(" kn");
        if (!o.isNull("windrichtingKompas")) sb.append(' ').append(o.optString("windrichtingKompas"));
        if (!o.isNull("windvlaagKnopen")) sb.append(" · vlagen ").append(o.optInt("windvlaagKnopen")).append(" kn");
        return sb.toString();
    }

    static String kansTekst(JSONObject kans) {
        if (kans == null || !kans.optBoolean("gevonden", false)) return "Volgende kans: geen binnen je horizon";
        return "Volgende kans: " + kans.optString("dagLabel") + " " + kans.optString("vanaf") + "–" + kans.optString("tot")
                + " · " + score(kans) + "/10";
    }

    /**
     * De dagen voor de grafiekkaarten. Een backend van vóór v98 stuurt nog geen `dagen`: dan één
     * dag (vandaag) uit de losse velden en `uren`, zodat de widget ook dan een grafiek heeft.
     */
    static JSONArray dagen(JSONObject data) {
        JSONArray dagen = data.optJSONArray("dagen");
        if (dagen != null) return dagen;
        JSONArray resultaat = new JSONArray();
        JSONArray uren = data.optJSONArray("uren");
        if (uren == null || uren.length() == 0) return resultaat;
        try {
            JSONObject vandaag = new JSONObject();
            vandaag.put("dagLabel", "Vandaag");
            for (String sleutel : new String[] { "kleur", "score", "verdict", "windKnopen", "windvlaagKnopen", "windrichtingKompas" }) {
                if (data.has(sleutel)) vandaag.put(sleutel, data.get(sleutel));
            }
            vandaag.put("uren", uren);
            resultaat.put(vandaag);
        } catch (JSONException e) {
            // Kan niet: alle sleutels zijn constant en de waarden komen uit geldige JSON.
        }
        return resultaat;
    }

    /** Korte weekdag ("za") uit "YYYY-MM-DD"; null als de datum ontbreekt of ongeldig is. */
    static String weekdag(String datum) {
        if (datum == null || !datum.matches("\\d{4}-\\d{2}-\\d{2}")) return null;
        String[] d = datum.split("-");
        Calendar c = new GregorianCalendar(Integer.parseInt(d[0]), Integer.parseInt(d[1]) - 1, Integer.parseInt(d[2]));
        return WEEKDAGEN[c.get(Calendar.DAY_OF_WEEK) - 1];
    }

    /** Chip in de dagenstrook van het overzicht: "za 7.5". */
    static String chipTekst(JSONObject dag) {
        String label = weekdag(dag.optString("datum", null));
        if (label == null) label = dag.optString("dagLabel", "?");
        return label + " " + score(dag);
    }

    /** "zo 27 sep" naast het label, tenzij het label zelf al de datum is ("do 1 okt"). */
    static String datumNaastLabel(JSONObject dag) {
        String datumKort = dag.optString("datumKort", "");
        return datumKort.equals(dag.optString("dagLabel", "")) ? "" : datumKort;
    }

    /** Beste venster ("13:00–17:00"), leeg als er geen is. */
    static String vensterTekst(JSONObject dag) {
        JSONObject venster = dag.optJSONObject("venster");
        if (venster == null) return "";
        return venster.optString("vanaf") + "–" + venster.optString("tot");
    }

    /** "Goede kite-conditie · 18 kn ZW · vlagen 24 kn · indicatief" (wind zonder emoji). */
    static String dagDetail(JSONObject dag) {
        StringBuilder sb = new StringBuilder(dag.optString("verdict", ""));
        String wind = windTekst(dag);
        if (!wind.isEmpty()) {
            if (sb.length() > 0) sb.append(" · ");
            sb.append(wind.substring("💨 ".length()));
        }
        if (dag.optBoolean("indicatief", false)) sb.append(" · indicatief");
        return sb.toString();
    }

    /**
     * Gezamenlijke kn-schaal voor alle dagkaarten (hoogste wind of vlaag, afgerond op 5, minstens
     * 15), zodat je dagen onderling kunt vergelijken tijdens het bladeren.
     */
    static int schaalMax(JSONArray dagen) {
        double max = 15;
        for (int d = 0; d < dagen.length(); d++) {
            JSONObject dag = dagen.optJSONObject(d);
            JSONArray uren = dag != null ? dag.optJSONArray("uren") : null;
            if (uren == null) continue;
            for (int i = 0; i < uren.length(); i++) {
                JSONObject u = uren.optJSONObject(i);
                if (u == null) continue;
                if (!u.isNull("windKnopen")) max = Math.max(max, u.optDouble("windKnopen"));
                if (!u.isNull("windvlaagKnopen")) max = Math.max(max, u.optDouble("windvlaagKnopen"));
            }
        }
        return (int) (Math.ceil(max / 5.0) * 5);
    }

    /** Na zo lang niet bladeren toont de widget weer het overzicht (pagina 1). */
    static final long PAGINA_GELDIG_MS = 10 * 60 * 1000;

    /** Te tonen pagina (0 = overzicht): de laatst gekozen, tenzij verlopen of buiten bereik. */
    static int huidigePagina(int opgeslagen, long gekozenOp, long nu, int aantal) {
        if (nu - gekozenOp > PAGINA_GELDIG_MS || opgeslagen < 0 || opgeslagen >= aantal) return 0;
        return opgeslagen;
    }

    /** "Overzicht · 1/6", "Morgen · 3/6". */
    static String paginaLabel(JSONArray dagen, int pagina) {
        String naam = "Overzicht";
        if (pagina > 0) {
            JSONObject dag = dagen.optJSONObject(pagina - 1);
            naam = dag != null ? dag.optString("dagLabel", "Dag " + pagina) : "Dag " + pagina;
        }
        return naam + " · " + (pagina + 1) + "/" + (dagen.length() + 1);
    }

    /** "13:00" -> 13; -1 als het geen uur is. */
    static int uurVan(String tijd) {
        if (tijd == null || !tijd.matches("\\d{1,2}:\\d{2}")) return -1;
        return Integer.parseInt(tijd.substring(0, tijd.indexOf(':')));
    }
}
