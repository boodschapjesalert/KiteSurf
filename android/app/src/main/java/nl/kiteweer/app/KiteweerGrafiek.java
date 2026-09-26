package nl.kiteweer.app;

import android.content.Context;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.DashPathEffect;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.util.DisplayMetrics;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Calendar;

/**
 * Tekent de grafiek van één dag voor een dagkaart in de widget. Zelfde opbouw als de Grafiek-tab
 * van de app (bouwUurGrafiek in JavaScript.html): balken = windsnelheid (kleur = oordeel van dat
 * uur), lijn = vlagen. Daarbij: pijltjes voor de windrichting, druppels bij regen, het beste
 * venster gemarkeerd en bij vandaag een streepjeslijn op "nu".
 */
final class KiteweerGrafiek {
    // Bitmaps in een widgetlijst gaan per item over binder: houd ze klein (~560 KB ARGB).
    private static final int MAX_PIXELS = 140_000;

    private KiteweerGrafiek() {}

    static boolean isDonker(Context context) {
        return (context.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
    }

    /** Kleur van een uur-/dagoordeel in de grafiek (in donkere modus iets lichter). */
    static int kleurVan(String kleur, boolean donker) {
        if ("groen".equals(kleur)) return donker ? 0xFF4CAF50 : 0xFF2E7D32;
        if ("oranje".equals(kleur)) return donker ? 0xFFFF9800 : 0xFFEF6C00;
        if ("rood".equals(kleur)) return donker ? 0xFFEF5350 : 0xFFC62828;
        return donker ? 0xFF90A4AE : 0xFF607D8B;
    }

    /**
     * @param dag       één element van `dagen` (uren, kleur, venster)
     * @param schaalMax kn bovenaan de as, voor alle dagen gelijk (KiteweerWidgetTekst.schaalMax)
     * @param breedteDp/hoogteDp gewenste weergavegrootte; de bitmap krijgt een passende dichtheid
     */
    static Bitmap tekenDag(Context context, JSONObject dag, boolean vandaag, int schaalMax, int breedteDp, int hoogteDp) {
        boolean donker = isDonker(context);
        DisplayMetrics metrics = context.getResources().getDisplayMetrics();
        float s = (float) Math.min(metrics.density, Math.sqrt(MAX_PIXELS / (double) (breedteDp * hoogteDp)));
        float fontSchaal = Math.max(0.85f, Math.min(1.3f, context.getResources().getConfiguration().fontScale));
        int breedte = Math.max(1, Math.round(breedteDp * s));
        int hoogte = Math.max(1, Math.round(hoogteDp * s));

        Bitmap bitmap = Bitmap.createBitmap(breedte, hoogte, Bitmap.Config.ARGB_8888);
        // Zo toont een ImageView met wrap_content de bitmap op breedteDp x hoogteDp.
        bitmap.setDensity(Math.round(s * DisplayMetrics.DENSITY_DEFAULT));
        Canvas canvas = new Canvas(bitmap);

        int tekstKleur = donker ? 0xB3FFFFFF : 0xB3000000;
        int hulpKleur = donker ? 0x29FFFFFF : 0x1F000000;
        int lijnKleur = donker ? 0xFFFFFFFF : 0xFF263238;
        int regenKleur = donker ? 0xFF64B5F6 : 0xFF1E88E5;

        Paint tekst = new Paint(Paint.ANTI_ALIAS_FLAG);
        tekst.setColor(tekstKleur);
        tekst.setTextSize(9.5f * s * fontSchaal);

        JSONArray uren = dag.optJSONArray("uren");
        int n = uren != null ? uren.length() : 0;
        if (n == 0) {
            String geen = "Geen uurdata";
            canvas.drawText(geen, (breedte - tekst.measureText(geen)) / 2, hoogte / 2f, tekst);
            return bitmap;
        }

        boolean heeftRichting = false, heeftRegen = false;
        for (int i = 0; i < n; i++) {
            JSONObject u = uren.optJSONObject(i);
            if (u == null) continue;
            if (!u.isNull("windrichtingGraden")) heeftRichting = true;
            if (u.optDouble("neerslagMm", 0) >= 0.2) heeftRegen = true;
        }

        float pijlRij = heeftRichting ? 13 * s : 0;
        float regenRij = heeftRegen ? 9 * s : 0;
        float labelRij = tekst.getTextSize() + 4 * s;
        float asBreedte = tekst.measureText("00") + 5 * s;
        float plotLinks = asBreedte;
        float plotBoven = pijlRij + regenRij + tekst.getTextSize() / 2;
        float plotOnder = hoogte - labelRij;
        float plotHoogte = plotOnder - plotBoven;
        float kolom = (breedte - plotLinks) / n;
        int eersteUur = uren.optJSONObject(0) != null ? uren.optJSONObject(0).optInt("uur", 0) : 0;

        // Beste venster als lichte band achter de balken.
        JSONObject venster = dag.optJSONObject("venster");
        if (venster != null) {
            int vanaf = KiteweerWidgetTekst.uurVan(venster.optString("vanaf"));
            int tot = KiteweerWidgetTekst.uurVan(venster.optString("tot"));
            if (tot <= vanaf) tot += 24;
            if (vanaf >= 0) {
                float x1 = Math.max(plotLinks, plotLinks + (vanaf - eersteUur) * kolom);
                float x2 = Math.min(breedte, plotLinks + (tot - eersteUur) * kolom);
                if (x2 > x1) {
                    Paint band = new Paint();
                    band.setColor((kleurVan(dag.optString("kleur"), donker) & 0x00FFFFFF) | (donker ? 0x38000000 : 0x2E000000));
                    canvas.drawRect(x1, plotBoven, x2, plotOnder, band);
                }
            }
        }

        // As: bovenkant, halverwege en nullijn.
        Paint hulplijn = new Paint();
        hulplijn.setColor(hulpKleur);
        hulplijn.setStrokeWidth(Math.max(1, s * 0.8f));
        tekst.setTextAlign(Paint.Align.RIGHT);
        float tekstMidden = (tekst.descent() + tekst.ascent()) / 2;
        for (int stap = 0; stap <= 2; stap++) {
            float y = plotOnder - plotHoogte * stap / 2f;
            canvas.drawLine(plotLinks, y, breedte, y, hulplijn);
            if (stap > 0) canvas.drawText(String.valueOf(schaalMax * stap / 2), asBreedte - 4 * s, y - tekstMidden, tekst);
        }
        canvas.drawText("kn", asBreedte - 4 * s, hoogte - 2 * s, tekst);
        tekst.setTextAlign(Paint.Align.CENTER);

        Paint balk = new Paint(Paint.ANTI_ALIAS_FLAG);
        Paint pijl = new Paint(Paint.ANTI_ALIAS_FLAG);
        pijl.setColor(donker ? 0xE6FFFFFF : 0xCC000000);
        pijl.setStrokeWidth(1.3f * s);
        pijl.setStrokeCap(Paint.Cap.ROUND);
        Paint regen = new Paint(Paint.ANTI_ALIAS_FLAG);
        Path vlaagLijn = new Path();
        boolean lijnGestart = false;
        float marge = Math.max(s, kolom * 0.16f);
        float straal = 2.5f * s;
        int pijlStap = kolom >= 12 * s ? 1 : 2;
        int labelStap = kolom >= 24 * s ? 2 : 3;

        for (int i = 0; i < n; i++) {
            JSONObject u = uren.optJSONObject(i);
            if (u == null) continue;
            float x = plotLinks + i * kolom;
            float midden = x + kolom / 2;
            if (!u.isNull("windKnopen")) {
                float h = Math.max(1.5f * s, (float) Math.min(1, u.optDouble("windKnopen") / schaalMax) * plotHoogte);
                balk.setColor(kleurVan(u.optString("kleur"), donker));
                RectF r = new RectF(x + marge, plotOnder - h, x + kolom - marge, plotOnder);
                canvas.drawRoundRect(r, straal, straal, balk);
                if (h > straal) canvas.drawRect(r.left, plotOnder - straal, r.right, plotOnder, balk);
            }
            if (!u.isNull("windvlaagKnopen")) {
                float y = plotOnder - (float) Math.min(1, u.optDouble("windvlaagKnopen") / schaalMax) * plotHoogte;
                if (lijnGestart) vlaagLijn.lineTo(midden, y);
                else {
                    vlaagLijn.moveTo(midden, y);
                    lijnGestart = true;
                }
            }
            if (heeftRichting && !u.isNull("windrichtingGraden") && i % pijlStap == 0) {
                tekenPijl(canvas, pijl, midden, pijlRij / 2, Math.min(kolom * 0.8f * pijlStap, 10 * s), u.optDouble("windrichtingGraden"));
            }
            double mm = u.optDouble("neerslagMm", 0);
            if (heeftRegen && mm >= 0.2) {
                regen.setColor(mm >= 1 ? regenKleur : (regenKleur & 0x00FFFFFF) | 0x99000000);
                tekenDruppel(canvas, regen, midden, pijlRij + regenRij * 0.6f, 2.4f * s);
            }
            int uur = u.optInt("uur", -1);
            if (uur >= 0 && uur % labelStap == 0) canvas.drawText(String.valueOf(uur), midden, hoogte - 2 * s, tekst);
        }

        Paint lijn = new Paint(Paint.ANTI_ALIAS_FLAG);
        lijn.setStyle(Paint.Style.STROKE);
        lijn.setStrokeWidth(1.6f * s);
        lijn.setStrokeJoin(Paint.Join.ROUND);
        lijn.setColor(lijnKleur);
        canvas.drawPath(vlaagLijn, lijn);

        if (vandaag) {
            Calendar nu = Calendar.getInstance();
            float uurNu = nu.get(Calendar.HOUR_OF_DAY) + nu.get(Calendar.MINUTE) / 60f;
            float x = plotLinks + (uurNu - eersteUur) * kolom;
            if (x >= plotLinks && x <= breedte) {
                Paint streep = new Paint(Paint.ANTI_ALIAS_FLAG);
                streep.setColor(lijnKleur);
                streep.setStrokeWidth(1.2f * s);
                streep.setPathEffect(new DashPathEffect(new float[] { 3 * s, 2.5f * s }, 0));
                canvas.drawLine(x, plotBoven - tekst.getTextSize() / 2, x, plotOnder, streep);
            }
        }
        return bitmap;
    }

    /** Pijl in de richting waar de wind naartoe waait (windrichting = waar hij vandaan komt). */
    private static void tekenPijl(Canvas canvas, Paint paint, float cx, float cy, float lengte, double graden) {
        double hoek = Math.toRadians(graden + 180);
        float dx = (float) Math.sin(hoek), dy = (float) -Math.cos(hoek);
        float half = lengte / 2;
        float puntX = cx + dx * half, puntY = cy + dy * half;
        paint.setStyle(Paint.Style.STROKE);
        canvas.drawLine(cx - dx * half, cy - dy * half, puntX - dx * lengte * 0.3f, puntY - dy * lengte * 0.3f, paint);
        float kop = lengte * 0.45f, breed = lengte * 0.28f;
        Path p = new Path();
        p.moveTo(puntX, puntY);
        p.lineTo(puntX - dx * kop - dy * breed, puntY - dy * kop + dx * breed);
        p.lineTo(puntX - dx * kop + dy * breed, puntY - dy * kop - dx * breed);
        p.close();
        paint.setStyle(Paint.Style.FILL);
        canvas.drawPath(p, paint);
    }

    private static void tekenDruppel(Canvas canvas, Paint paint, float cx, float cy, float r) {
        Path p = new Path();
        p.moveTo(cx, cy - r * 2.1f);
        p.lineTo(cx + r * 0.9f, cy - r * 0.35f);
        p.lineTo(cx - r * 0.9f, cy - r * 0.35f);
        p.close();
        canvas.drawPath(p, paint);
        canvas.drawCircle(cx, cy + r * 0.25f, r, paint);
    }
}
